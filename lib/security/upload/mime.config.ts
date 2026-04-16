/**
 * ============================================================================
 * MÓDULO: Configuração de Contextos de Upload (Onda 2 - E2.3)
 * ============================================================================
 * * OBJETIVO:
 * Definir as allowlists (listas de permissão) restritas para uploads baseados 
 * no contexto da aplicação. 
 * * * DECISÕES DE SEGURANÇA (Camada C10 da Matriz de Defesa):
 * 1. Tamanho Restrito (maxSizeBytes): Previne ataques de exaustão de recursos 
 * (Upload DoS e Zip Bombs limitadas pelo tamanho máximo).
 * 2. Restrição de SVG (⚠️): Como o SVG é um formato XML que suporta tags 
 * <script> e eventos (onload), ele é permitido APENAS no contexto de 
 * `team_logo` e passará por uma sanitização agressiva dedicada antes de 
 * ser salvo no storage.
 * 3. Consistência: O motor de upload exigirá que os Magic Bytes do arquivo 
 * correspondam EXATAMENTE aos MIMEs listados aqui.
 * ============================================================================
 */

export const UPLOAD_CONTEXTS = {
  // Imagens de produto na loja (E-commerce)
  product_image: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxWidth: 4000,
    maxHeight: 4000,
  },
  
  // Fotos das quadras / locais de jogos
  venue_photo: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 8 * 1024 * 1024, // 8 MB
    maxWidth: 6000,
    maxHeight: 6000,
  },
  
  // Foto de perfil do usuário ou jogador
  avatar: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 2 * 1024 * 1024, // 2 MB
    maxWidth: 1024,
    maxHeight: 1024,
  },
  
  // Escudo/Logo de times e patrocinadores (Único local que aceita SVG no momento)
  team_logo: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp", "svg"],
    maxSizeBytes: 1 * 1024 * 1024, // 1 MB
  },
  
  // Imagens para Álbuns de Eventos ou Campanhas
  event_album_image: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  },
  
  // Vídeos para Álbuns de Eventos ou Highlights
  event_album_video: {
    allowedMimes: ["video/mp4", "video/webm"],
    allowedExtensions: ["mp4", "webm"],
    maxSizeBytes: 200 * 1024 * 1024, // 200 MB
  },
  
  // Capas de artigos de notícias
  article_cover: {
    allowedMimes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 3 * 1024 * 1024, // 3 MB
  },
  
  // Documentos em PDF (Ex: Regulamentos, autorizações para menores)
  document_attachment: {
    allowedMimes: ["application/pdf"],
    allowedExtensions: ["pdf"],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  },
} as const;

export type UploadContext = keyof typeof UPLOAD_CONTEXTS;