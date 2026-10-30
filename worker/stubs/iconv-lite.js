'use strict';
// Stub iconv-lite untuk bundling Cloudflare Workers.
// body-parser/raw-body hanya memakai iconv untuk charset non-utf8; endpoint kita
// selalu application/json;utf-8, jadi decode/encode di sini tidak pernah benar-benar dipakai.
function unsupported() {
  throw new Error('Charset non-utf8 tidak didukung di Cloudflare Workers.');
}
const iconv = {
  decode: unsupported,
  encode: unsupported,
  getCodec: unsupported,
  getEncoder: unsupported,
  getDecoder: unsupported,
  encodingExists: () => false,
  canonicalEncoding: (e) => e,
  _canonicalizeEncoding: (e) => e,
};
module.exports = iconv;
module.exports.default = iconv;
