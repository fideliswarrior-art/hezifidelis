import * as argon2 from "argon2";

/**
 * Gera o hash da senha utilizando o algoritmo argon2id, 
 * o padrão recomendado para armazenamento seguro.
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 65536,
      parallelism: 4,
    });
  } catch (error) {
    throw new Error("Erro ao gerar hash da senha");
  }
}

/**
 * Verifica se a senha em texto puro corresponde ao hash armazenado.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch (error) {
    return false;
  }
}