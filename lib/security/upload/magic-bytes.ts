/**
 * ============================================================================
 * MÓDULO: Dicionário de Assinaturas Binárias (Magic Bytes) - Onda 2 (E2.3)
 * ============================================================================
 * * OBJETIVO:
 * Fornecer uma fonte de verdade imutável para a validação de arquivos. 
 * Hackers frequentemente renomeiam arquivos maliciosos (ex: exploit.php para 
 * foto.jpg) e forjam o Content-Type no envio. Este módulo ignora essas 
 * declarações e lê a estrutura binária real (hexadecimal) do arquivo.
 * * * DECISÕES DE SEGURANÇA (Camada C10):
 * Atua como a "Camada 2" do nosso funil de upload. Se o arquivo não começar 
 * EXATAMENTE com os bytes listados aqui, ele é sumariamente rejeitado.
 * ============================================================================
 */

// Tabela de assinaturas hexadecimais para os formatos permitidos pela plataforma.
// O 'offset' indica a partir de qual byte a assinatura começa.
export const MAGIC_BYTES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  // JPEG começa com FF D8 FF
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  
  // PNG começa com 89 50 4E 47 0D 0A 1A 0A
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  
  // WebP começa com RIFF (offset 0) e WEBP (offset 8)
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // 'R', 'I', 'F', 'F'
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // 'W', 'E', 'B', 'P'
  ],
  
  // GIF começa com GIF8 (offset 0)
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  
  // MP4 possui a assinatura 'ftyp' no offset 4 em quase todas as suas variantes
  "video/mp4": [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  ],
  
  // WebM começa com 1A 45 DF A3
  "video/webm": [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  
  // PDF começa com %PDF
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
};

/**
 * Verifica se um buffer binário corresponde à assinatura esperada para o seu MIME.
 * * @param buffer O buffer de memória contendo os primeiros bytes do arquivo.
 * @param mime O MIME type que queremos verificar (ex: "image/png").
 * @returns true se a assinatura binária bater, false caso contrário.
 */
export function matchesMagicBytes(buffer: Buffer, mime: string): boolean {
  const signatures = MAGIC_BYTES[mime];
  
  // Se o MIME type não estiver na nossa tabela, rejeitamos por segurança (Fail-Secure).
  if (!signatures) return false; 
  
  // Verifica se TODAS as partes da assinatura (ex: RIFF e WEBP no caso de WebP) coincidem
  return signatures.every(sig =>
    sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte)
  );
}