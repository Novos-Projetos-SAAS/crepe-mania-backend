import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.stdout.write([
  '# Copie para um gerenciador de segredos; nao versione em .env.',
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  '',
].join('\n'));
