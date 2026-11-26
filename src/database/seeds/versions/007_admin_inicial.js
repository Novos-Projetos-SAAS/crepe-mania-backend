export async function apply(trx, { env, hashPassword }) {
    const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = env;
    if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
        throw new Error('ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD sao obrigatorios para o seed inicial.');
    }
    if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD deve ter no minimo 12 caracteres.');
    if (!/[a-z]/.test(ADMIN_PASSWORD) || !/[A-Z]/.test(ADMIN_PASSWORD) || !/\d/.test(ADMIN_PASSWORD)) throw new Error('ADMIN_PASSWORD deve conter letra minuscula, maiuscula e numero.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) throw new Error('ADMIN_EMAIL invalido.');
    const existing = await trx('usuarios').whereRaw('LOWER(email) = LOWER(?)', [ADMIN_EMAIL]).first();
    const level = await trx('niveis_acesso').where({ nome: 'admin', ativo: true }).first();
    if (!level) throw new Error('Nivel admin nao encontrado; execute os seeds em ordem.');
    if (existing) {
        if (String(existing.nivel_acesso_id) !== String(level.id)) throw new Error('ADMIN_EMAIL ja pertence a um usuario que nao e administrador.');
        return;
    }
    const existingAdmin = await trx('usuarios').where({ nivel_acesso_id: level.id }).whereNull('deletado_em').first();
    if (existingAdmin) return;
    await trx('usuarios').insert({
        nivel_acesso_id: level.id,
        nome: ADMIN_NAME.trim(),
        email: ADMIN_EMAIL.trim().toLowerCase(),
        senha_hash: await hashPassword(ADMIN_PASSWORD),
        ativo: true,
    });
}
