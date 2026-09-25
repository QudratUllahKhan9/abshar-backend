// Full flow test: login -> otp -> verify -> me (seed user: +923358150949 / 123456)
const BASE = 'http://127.0.0.1:4000';
const call = async (p, b) => {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
  });
  return { s: r.status, j: await r.json() };
};

(async () => {
  // 1) Galat password
  let x = await call('/api/login', { phone: '+923358150949', password: 'wrong' });
  console.log('galat password ->', x.s, x.j.message);

  // 2) Sahi login -> OTP
  x = await call('/api/login', { phone: '+923358150949', password: '123456' });
  console.log('login ->', x.s, 'OTP:', x.j.otp, '| expiresIn:', x.j.expiresIn);
  const otp = x.j.otp;

  // 3) Galat OTP
  x = await call('/api/verify-otp', { phone: '+923358150949', otp: '000000' });
  console.log('galat OTP ->', x.s, x.j.message);

  // 4) Sahi OTP -> token
  x = await call('/api/verify-otp', { phone: '+923358150949', otp });
  console.log('verify ->', x.s, '| token mila:', !!x.j.token);

  // 5) /me — sirf usi number ka data
  const r = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + x.j.token } });
  const me = await r.json();
  console.log('me ->', r.status, '| name:', me.user?.name, '| cnic:', me.user?.cnic);
  console.log('data keys:', me.user?.data ? Object.keys(me.user.data).join(', ') : 'none');
})().catch((e) => { console.error('TEST ERROR:', e.message); process.exit(1); });
