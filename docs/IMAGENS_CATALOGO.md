# Associação das imagens do catálogo

A seed versionada `015_imagens_produtos_crepe_mania.js` associa **68 dos 75 produtos** do catálogo inicial. As imagens WebP ficam no repositório frontend, em `public/images/produtos/`. Os quatro refrigerantes de marca e as três barcas aguardam confirmação do cliente; a lista está em `docs/produtos-sem-imagem.md` no frontend.

A seed usa `CATALOG_IMAGE_BASE_URL` para construir URLs absolutas. O domínio confirmado no projeto Vercel é `https://crepe-mania.vercel.app`, usado como padrão. Ela localiza cada produto por **categoria e nome**, atualiza apenas `imagem_url` vazio, preserva URLs manuais, não cria produtos e registra itens ausentes ou duplicados.

**Ordem de publicação:** implantar primeiro o frontend e verificar que os WebP estão acessíveis; depois executar `npm run db:seed` no backend. A seed 015 será registrada em `controle_seeds` com checksum. Após isso, qualquer associação para os sete pendentes deve ser feita por uma nova seed versionada, sem alterar a 015 nem as seeds históricas 011/012.
