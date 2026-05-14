// Set working hours for the test business owner via the API
// First get a session token, then call the schedule update endpoint

const workingHours = {
  monday:    { enabled: true, start: "09:00", end: "18:00" },
  tuesday:   { enabled: true, start: "09:00", end: "18:00" },
  wednesday: { enabled: true, start: "09:00", end: "18:00" },
  thursday:  { enabled: true, start: "09:00", end: "18:00" },
  friday:    { enabled: true, start: "09:00", end: "18:00" },
  saturday:  { enabled: true, start: "10:00", end: "16:00" },
  sunday:    { enabled: false, start: "09:00", end: "18:00" },
};

// Step 1: Send OTP
const sendRes = await fetch('http://localhost:3000/api/trpc/otp.send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ json: { phone: '5550019999', type: 'owner' } }),
});
const sendData = await sendRes.json();
console.log('OTP send:', JSON.stringify(sendData).slice(0, 100));

// Step 2: Verify OTP
const verifyRes = await fetch('http://localhost:3000/api/trpc/otp.verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ json: { phone: '5550019999', code: '123456', type: 'owner' } }),
});
const verifyData = await verifyRes.json();
const token = verifyData?.result?.data?.json?.token;
console.log('Token:', token ? token.slice(0, 20) + '...' : 'NOT FOUND');

if (!token) {
  console.error('Failed to get token');
  process.exit(1);
}

// Step 3: Update schedule/working hours
const schedRes = await fetch('http://localhost:3000/api/trpc/schedule.update', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ json: { workingHours } }),
});
const schedData = await schedRes.json();
console.log('Schedule update:', JSON.stringify(schedData).slice(0, 200));

process.exit(0);
