// =============================================================================
// HEZI TECH — GUARD: RECÁLCULO SERVER-SIDE DE TOTAL DO PEDIDO
// =============================================================================
// Arquivo: lib/security/guards/require-server-total.ts
// Camada de Defesa: C7 (Financeiro/Loja)
// Artigos LGPD: Art. 6º VII (Segurança), Art. 46 (Medidas técnicas)
//
// PROPÓSITO:
//   Recalcular o totalAmount de um pedido INTEIRAMENTE no servidor,
//   descartando qualquer valor enviado pelo cliente. Também valida
//   estoque e cupom de desconto em uma operação atômica.
//
//   Sem este guard, um atacante poderia:
//     • Enviar totalAmount = 0.01 no body e comprar produtos de graça.
//     • Adicionar items com preço manipulado.
//     • Usar cupom expirado, inativo ou que já atingiu maxUses.
//     • Comprar variantes sem estoque (race condition).
//
// REGRAS DE NEGÓCIO ASSOCIADAS:
//   • Order.totalAmount — calculado server-side como soma de
//     (OrderItem.quantity × unitPrice) + shipping - discount.
//     Campo enviado pelo cliente é DESCARTADO.
//   • Cupom — validar isActive, validFrom ≤ now ≤ validUntil,
//     usedCount < maxUses em SELECT FOR UPDATE.
//   • TicketBatch.soldQuantity — incrementado atomicamente.
//     Validar soldQuantity < totalQuantity.
//   • Nunca usar Float para dinheiro — sempre Decimal.
//   (Ref: Seção 12.2, 12.4 — Regras de negócio e integridade financeira)
//
// REFERÊNCIAS:
//   • Matriz de Defesa v1.0 — Camada C7
//   • OWASP — Business Logic Vulnerabilities
//   • policy.config.json — CP-12 (E-commerce)
// =============================================================================

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Item enviado pelo cliente no payload de checkout.
 * O `unitPrice` enviado pelo cliente é IGNORADO — serve apenas
 * para detecção de inconsistência (alerta ao frontend).
 */
interface CheckoutItem {
  readonly productId: string;
  readonly variantId?: string | null;
  readonly quantity: number;
  /** Preço informado pelo client (ignorado no cálculo, usado apenas para comparação). */
  readonly clientUnitPrice?: number;
}

/**
 * Item validado e precificado pelo servidor.
 */
interface ValidatedItem {
  readonly productId: string;
  readonly productName: string;
  readonly variantId: string | null;
  readonly variantSku: string | null;
  readonly quantity: number;
  /** Preço unitário real do servidor (Product.price + Variant.priceAdjust). */
  readonly unitPrice: Decimal;
  /** Subtotal do item (quantity × unitPrice). */
  readonly subtotal: Decimal;
  /** Se o preço do client divergiu do servidor. */
  readonly priceDiscrepancy: boolean;
}

/**
 * Resultado completo da validação e cálculo do pedido.
 */
interface ServerOrderTotal {
  /** Items validados com preço do servidor. */
  readonly items: readonly ValidatedItem[];
  /** Soma de todos os subtotais dos items. */
  readonly subtotal: Decimal;
  /** Valor de frete (passado pelo caller — regra de frete é externa). */
  readonly shippingAmount: Decimal;
  /** Valor de desconto aplicado (0 se sem cupom). */
  readonly discountAmount: Decimal;
  /** Total final: subtotal + shipping - discount (nunca negativo). */
  readonly totalAmount: Decimal;
  /** Dados do cupom aplicado, se houver. */
  readonly coupon: ValidatedCoupon | null;
  /** Se algum item teve divergência de preço client vs server. */
  readonly hasPriceDiscrepancies: boolean;
}

/**
 * Cupom validado pelo servidor.
 */
interface ValidatedCoupon {
  readonly id: string;
  readonly code: string;
  readonly discountPct: number | null;
  readonly discountFixed: Decimal | null;
}

// -----------------------------------------------------------------------------
// CLASSES DE ERRO
// -----------------------------------------------------------------------------

/**
 * Erro genérico de checkout — mapeado para HTTP 422.
 */
export class CheckoutError extends Error {
  public readonly statusCode = 422;

  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "CheckoutError";
  }
}

/**
 * Erro de estoque insuficiente.
 */
export class InsufficientStockError extends CheckoutError {
  constructor(
    public readonly productName: string,
    public readonly available: number,
    public readonly requested: number
  ) {
    super(
      `Estoque insuficiente para "${productName}". ` +
      `Disponível: ${String(available)}, solicitado: ${String(requested)}.`,
      "INSUFFICIENT_STOCK"
    );
    this.name = "InsufficientStockError";
  }
}

/**
 * Erro de produto não encontrado ou inativo.
 */
export class ProductNotAvailableError extends CheckoutError {
  constructor(_productId: string) {
    super(
      `Produto não encontrado ou indisponível.`,
      "PRODUCT_NOT_AVAILABLE"
    );
    this.name = "ProductNotAvailableError";
  }
}

/**
 * Erro de cupom inválido.
 */
export class CouponError extends CheckoutError {
  constructor(message: string) {
    super(message, "INVALID_COUPON");
    this.name = "CouponError";
  }
}

/**
 * Erro de carrinho vazio.
 */
export class EmptyCartError extends CheckoutError {
  constructor() {
    super("O carrinho está vazio.", "EMPTY_CART");
    this.name = "EmptyCartError";
  }
}

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO
// -----------------------------------------------------------------------------

/** Quantidade máxima de items distintos em um único pedido. */
const MAX_ITEMS_PER_ORDER = 50;

/** Quantidade máxima de um único item. */
const MAX_QUANTITY_PER_ITEM = 20;

/** Valor mínimo de um pedido (em R$). Previne pedidos de R$ 0.00. */
const MIN_ORDER_TOTAL = new Decimal("0.01");

const ZERO = new Decimal(0);

// -----------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// -----------------------------------------------------------------------------

/**
 * Recalcula o total de um pedido inteiramente no servidor.
 * 
 * FLUXO:
 *   1. Valida estrutura do carrinho (não vazio, quantidades válidas).
 *   2. Busca cada produto/variante no banco — confirma existência e preço.
 *   3. Valida estoque de cada variante.
 *   4. Valida cupom de desconto (se fornecido) com todas as regras.
 *   5. Calcula: subtotal + shipping - discount = totalAmount.
 *   6. Garante totalAmount ≥ MIN_ORDER_TOTAL.
 * 
 * IMPORTANTE: Esta função NÃO faz update no banco. Ela retorna os valores
 * calculados para que o order.service.ts os use no db.order.create() dentro
 * de uma transaction que também decrementa estoque e incrementa usedCount.
 * 
 * @param items          - Items do carrinho enviados pelo client.
 * @param couponCode     - Código do cupom (opcional).
 * @param shippingAmount - Frete calculado externamente (ou 0 para tickets).
 * 
 * @returns ServerOrderTotal com todos os valores calculados.
 * @throws EmptyCartError se o carrinho está vazio.
 * @throws ProductNotAvailableError se algum produto não existe ou está inativo.
 * @throws InsufficientStockError se o estoque não suporta a quantidade.
 * @throws CouponError se o cupom é inválido.
 * @throws CheckoutError para outros erros de validação.
 * 
 * @example
 * ```typescript
 * // Em order.service.ts — checkout():
 * const session = await requireAuth();
 * await requireEmailVerified(session);
 * 
 * const order = await requireServerTotal(
 *   cartItems,
 *   input.couponCode,
 *   calculatedShipping
 * );
 * 
 * // Usar order.totalAmount no db.order.create() — NUNCA o valor do client
 * await db.$transaction(async (tx) => {
 *   const created = await tx.order.create({
 *     data: {
 *       totalAmount: order.totalAmount,
 *       discountAmount: order.discountAmount,
 *       shippingAmount: order.shippingAmount,
 *       // ...
 *     }
 *   });
 *   // Decrementar estoque, incrementar coupon.usedCount, etc.
 * });
 * ```
 */
export async function requireServerTotal(
  items: readonly CheckoutItem[],
  couponCode?: string | null,
  shippingAmount: Decimal | number = 0
): Promise<ServerOrderTotal> {

  const shipping = new Decimal(shippingAmount);

  // -------------------------------------------------------------------------
  // 1. VALIDAÇÃO ESTRUTURAL DO CARRINHO
  // -------------------------------------------------------------------------
  if (!items || items.length === 0) {
    throw new EmptyCartError();
  }

  if (items.length > MAX_ITEMS_PER_ORDER) {
    throw new CheckoutError(
      `O pedido não pode ter mais de ${String(MAX_ITEMS_PER_ORDER)} items distintos.`,
      "TOO_MANY_ITEMS"
    );
  }

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutError(
        `Quantidade inválida para o produto. Mínimo: 1.`,
        "INVALID_QUANTITY"
      );
    }
    if (item.quantity > MAX_QUANTITY_PER_ITEM) {
      throw new CheckoutError(
        `Quantidade máxima por item é ${String(MAX_QUANTITY_PER_ITEM)}.`,
        "QUANTITY_EXCEEDED"
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. BUSCAR PRODUTOS E VALIDAR PREÇOS NO SERVIDOR
  // -------------------------------------------------------------------------
  const validatedItems: ValidatedItem[] = [];
  let subtotal = ZERO;

  for (const item of items) {
    const validated = await validateAndPriceItem(item);
    validatedItems.push(validated);
    subtotal = subtotal.plus(validated.subtotal);
  }

  // -------------------------------------------------------------------------
  // 3. VALIDAR CUPOM DE DESCONTO (SE FORNECIDO)
  // -------------------------------------------------------------------------
  let discountAmount = ZERO;
  let validatedCoupon: ValidatedCoupon | null = null;

  if (couponCode) {
    const couponResult = await validateCoupon(couponCode, subtotal);
    discountAmount = couponResult.discountAmount;
    validatedCoupon = couponResult.coupon;
  }

  // -------------------------------------------------------------------------
  // 4. CALCULAR TOTAL FINAL
  // -------------------------------------------------------------------------
  // totalAmount = subtotal + shipping - discount
  // Nunca negativo: se desconto > subtotal + shipping, totalAmount = MIN_ORDER_TOTAL
  let totalAmount = subtotal.plus(shipping).minus(discountAmount);

  if (totalAmount.lessThan(MIN_ORDER_TOTAL)) {
    totalAmount = MIN_ORDER_TOTAL;
  }

  // -------------------------------------------------------------------------
  // 5. RESULTADO
  // -------------------------------------------------------------------------
  const hasPriceDiscrepancies = validatedItems.some(i => i.priceDiscrepancy);

  return {
    items: validatedItems,
    subtotal,
    shippingAmount: shipping,
    discountAmount,
    totalAmount,
    coupon: validatedCoupon,
    hasPriceDiscrepancies,
  };
}

// -----------------------------------------------------------------------------
// FUNÇÕES INTERNAS
// -----------------------------------------------------------------------------

/**
 * Busca um produto (e variante, se aplicável) no banco e calcula o preço
 * unitário real server-side.
 * 
 * Preço unitário = Product.price + ProductVariant.priceAdjust (se houver).
 * 
 * Valida:
 *   - Produto existe e isActive = true.
 *   - Variante existe e pertence ao produto (se variantId fornecido).
 *   - Estoque suficiente (variant.stock ≥ quantity).
 */
async function validateAndPriceItem(item: CheckoutItem): Promise<ValidatedItem> {

  // Buscar produto (sem variantes — query separada para evitar
  // conflito com exactOptionalPropertyTypes no select condicional)
  const product = await db.product.findUnique({
    where: { id: item.productId },
    select: {
      id: true,
      name: true,
      price: true,
      isActive: true,
    },
  });

  // Produto não existe ou inativo
  if (!product || !product.isActive) {
    throw new ProductNotAvailableError(item.productId);
  }

  let unitPrice = new Decimal(product.price);
  let variantId: string | null = null;
  let variantSku: string | null = null;

  // Se variantId fornecido, buscar e validar variante separadamente
  if (item.variantId) {
    const variant = await db.productVariant.findFirst({
      where: {
        id: item.variantId,
        productId: product.id,
      },
      select: {
        id: true,
        sku: true,
        stock: true,
        priceAdjust: true,
      },
    });

    if (!variant) {
      throw new CheckoutError(
        `Variante não encontrada para o produto "${product.name}".`,
        "VARIANT_NOT_FOUND"
      );
    }

    // Validar estoque
    if (variant.stock < item.quantity) {
      throw new InsufficientStockError(
        `${product.name} (${variant.sku})`,
        variant.stock,
        item.quantity
      );
    }

    // Aplicar ajuste de preço da variante
    if (variant.priceAdjust) {
      unitPrice = unitPrice.plus(new Decimal(variant.priceAdjust));
    }

    variantId = variant.id;
    variantSku = variant.sku;
  }

  // Garantir que o preço unitário nunca seja negativo
  if (unitPrice.lessThan(ZERO)) {
    unitPrice = ZERO;
  }

  // Calcular subtotal do item
  const subtotal = unitPrice.times(item.quantity);

  // Detectar divergência de preço (client informou valor diferente)
  let priceDiscrepancy = false;
  if (item.clientUnitPrice !== undefined) {
    const clientDecimal = new Decimal(item.clientUnitPrice);
    priceDiscrepancy = !unitPrice.equals(clientDecimal);
  }

  return {
    productId: product.id,
    productName: product.name,
    variantId,
    variantSku,
    quantity: item.quantity,
    unitPrice,
    subtotal,
    priceDiscrepancy,
  };
}

/**
 * Valida um cupom de desconto com todas as regras de negócio.
 * 
 * REGRAS VALIDADAS:
 *   1. Cupom existe pelo código.
 *   2. Cupom isActive = true.
 *   3. validFrom ≤ now (já começou).
 *   4. validUntil ≥ now (não expirou) — se definido.
 *   5. usedCount < maxUses (não esgotou) — se definido.
 * 
 * NOTA: O incremento de usedCount NÃO acontece aqui — deve ser feito
 * na transaction do order.service.ts para garantir atomicidade.
 * 
 * DESCONTO:
 *   - discountPct: percentual sobre o subtotal (ex: 10 = 10%).
 *   - discountFixed: valor fixo em R$ (ex: 20.00).
 *   - Se ambos definidos, aplica APENAS o percentual (maior benefício
 *     para volumes altos, mas previsível — regra de negócio).
 */
async function validateCoupon(
  couponCode: string,
  subtotal: Decimal
): Promise<{ discountAmount: Decimal; coupon: ValidatedCoupon }> {

  const coupon = await db.coupon.findUnique({
    where: { code: couponCode },
    select: {
      id: true,
      code: true,
      isActive: true,
      discountPct: true,
      discountFixed: true,
      maxUses: true,
      usedCount: true,
      validFrom: true,
      validUntil: true,
    },
  });

  // 1. Existe?
  if (!coupon) {
    throw new CouponError("Cupom não encontrado.");
  }

  // 2. Ativo?
  if (!coupon.isActive) {
    throw new CouponError("Este cupom está desativado.");
  }

  const now = new Date();

  // 3. Já começou?
  if (coupon.validFrom > now) {
    throw new CouponError("Este cupom ainda não está válido.");
  }

  // 4. Não expirou?
  if (coupon.validUntil && coupon.validUntil < now) {
    throw new CouponError("Este cupom expirou.");
  }

  // 5. Não esgotou?
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throw new CouponError("Este cupom atingiu o limite de usos.");
  }

  // Calcular desconto
  let discountAmount = ZERO;

  if (coupon.discountPct) {
    // Percentual: subtotal × (pct / 100)
    discountAmount = subtotal.times(coupon.discountPct).dividedBy(100);
  } else if (coupon.discountFixed) {
    // Fixo: valor direto
    discountAmount = new Decimal(coupon.discountFixed);
  }

  // Desconto não pode exceder o subtotal
  if (discountAmount.greaterThan(subtotal)) {
    discountAmount = subtotal;
  }

  // Arredondar para 2 casas decimais
  discountAmount = discountAmount.toDecimalPlaces(2);

  return {
    discountAmount,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      discountPct: coupon.discountPct,
      discountFixed: coupon.discountFixed ? new Decimal(coupon.discountFixed) : null,
    },
  };
}