import { generateKeyPairSync, randomBytes } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const pub=publicKey.export({format:'jwk'}), priv=privateKey.export({format:'jwk'});
const key=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
// Run locally and save directly as untracked secrets; never commit this output.
console.log(JSON.stringify({VAPID_PUBLIC_KEY:key,VAPID_PRIVATE_KEY:priv.d,POLL_TOKEN:randomBytes(32).toString('base64url')}));
