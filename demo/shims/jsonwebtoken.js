// Demo-only stand-in for jsonwebtoken: the "token" is just the payload, base64-encoded.
// Fine for a demo that runs entirely inside one browser; never use this on a server.
const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

export default {
  sign(payload) {
    return `demo.${enc({ ...payload, iat: Date.now() })}`;
  },
  verify(token) {
    if (!token.startsWith('demo.')) throw new Error('bad token');
    return dec(token.slice(5));
  },
};
