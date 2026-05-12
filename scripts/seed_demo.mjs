// Seed realistic demo data for Wellness Suite (businessOwnerId = 1650001)
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = join(__dirname, '../.env');
let DATABASE_URL;
try {
  const env = readFileSync(envPath, 'utf8');
  const match = env.match(/DATABASE_URL=(.+)/);
  if (match) DATABASE_URL = match[1].trim();
} catch {}
DATABASE_URL = DATABASE_URL || process.env.DATABASE_URL;

const OWNER_ID = 1650001;

const CLIENTS = [
  { name: 'Sofia Martinez', phone: '4125550101', email: 'sofia.m@email.com', notes: 'Prefers deep tissue, no lavender' },
  { name: 'Emma Johnson', phone: '4125550102', email: 'emma.j@email.com', notes: 'Regular monthly facial client' },
  { name: 'Aisha Williams', phone: '4125550103', email: 'aisha.w@email.com', notes: 'Sensitive skin, use gentle products' },
  { name: 'Natalie Chen', phone: '4125550104', email: 'natalie.c@email.com', notes: 'Loves hydra facial combo' },
  { name: 'Rachel Kim', phone: '4125550105', email: 'rachel.k@email.com', notes: 'Swedish massage every 3 weeks' },
  { name: 'Priya Sharma', phone: '4125550106', email: 'priya.s@email.com', notes: 'Lash and brow specialist needed' },
  { name: 'Lauren Brooks', phone: '4125550107', email: 'lauren.b@email.com', notes: 'Body wrap + scrub combo' },
  { name: 'Mia Torres', phone: '4125550108', email: 'mia.t@email.com', notes: 'Aromatherapy only' },
  { name: 'Jasmine Reed', phone: '4125550109', email: 'jasmine.r@email.com', notes: 'Gift card holder' },
  { name: 'Olivia Scott', phone: '4125550110', email: 'olivia.s@email.com', notes: 'Prenatal massage' },
  { name: 'Chloe Adams', phone: '4125550111', email: 'chloe.a@email.com', notes: 'Acne-prone, avoid oils' },
  { name: 'Zoe Mitchell', phone: '4125550112', email: 'zoe.m@email.com', notes: 'Hot stone regular' },
  { name: 'Ava Thompson', phone: '4125550113', email: 'ava.t@email.com', notes: 'Couples massage with partner' },
  { name: 'Isabella Garcia', phone: '4125550114', email: 'isabella.g@email.com', notes: 'Monthly membership' },
  { name: 'Lily Nguyen', phone: '4125550115', email: 'lily.n@email.com', notes: 'First visit discount applied' },
  { name: 'Hannah Lee', phone: '4125550116', email: 'hannah.l@email.com', notes: 'Referred by Emma J.' },
  { name: 'Grace Wilson', phone: '4125550117', email: 'grace.w@email.com', notes: 'Scalp massage add-on always' },
  { name: 'Ella Brown', phone: '4125550118', email: 'ella.b@email.com', notes: 'Dermaplaning fan' },
  { name: 'Aria Davis', phone: '4125550119', email: 'aria.d@email.com', notes: 'VIP client — priority booking' },
  { name: 'Scarlett Moore', phone: '4125550120', email: 'scarlett.m@email.com', notes: 'Microdermabrasion monthly' },
  { name: 'Victoria Hall', phone: '4125550121', email: 'victoria.h@email.com', notes: 'Neck and shoulder focus' },
  { name: 'Penelope Young', phone: '4125550122', email: 'penelope.y@email.com', notes: 'Evening slots only' },
  { name: 'Layla King', phone: '4125550123', email: 'layla.k@email.com', notes: 'Seasonal facial packages' },
  { name: 'Riley Wright', phone: '4125550124', email: 'riley.w@email.com', notes: 'Sensitive to fragrance' },
  { name: 'Nora Lopez', phone: '4125550125', email: 'nora.l@email.com', notes: 'Bridal party coordinator' },
  { name: 'Hazel Hill', phone: '4125550126', email: 'hazel.h@email.com', notes: 'Wellness membership holder' },
  { name: 'Ellie Green', phone: '4125550127', email: 'ellie.g@email.com', notes: 'Sports massage' },
  { name: 'Stella Baker', phone: '4125550128', email: 'stella.b@email.com', notes: 'Reflexology + foot scrub' },
  { name: 'Maya Carter', phone: '4125550129', email: 'maya.c@email.com', notes: 'CBD massage add-on' },
  { name: 'Addison Phillips', phone: '4125550130', email: 'addison.p@email.com', notes: 'Bi-weekly appointments' },
];

// Get existing services
async function run() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  // Get existing services
  const [svcRows] = await conn.execute(
    'SELECT id, localId, name, price, duration FROM services WHERE businessOwnerId = ? LIMIT 20',
    [OWNER_ID]
  );
  console.log(`Found ${svcRows.length} services`);
  
  // Check existing clients
  const [existingClients] = await conn.execute(
    'SELECT phone FROM clients WHERE businessOwnerId = ?',
    [OWNER_ID]
  );
  const existingPhones = new Set(existingClients.map(c => c.phone));
  
  // Insert new clients
  let insertedClients = 0;
  const clientLocalIds = [];
  for (const client of CLIENTS) {
    const phone = client.phone;
    if (existingPhones.has(phone)) {
      // Get existing localId
      const [rows] = await conn.execute('SELECT localId FROM clients WHERE businessOwnerId = ? AND phone = ?', [OWNER_ID, phone]);
      if (rows.length) clientLocalIds.push({ localId: rows[0].localId, name: client.name });
      continue;
    }
    const localId = `client-demo-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    await conn.execute(
      'INSERT INTO clients (businessOwnerId, localId, name, phone, email, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,NOW(),NOW())',
      [OWNER_ID, localId, client.name, phone, client.email, client.notes]
    );
    clientLocalIds.push({ localId, name: client.name });
    insertedClients++;
  }
  console.log(`Inserted ${insertedClients} new clients`);

  // Generate appointments over last 90 days
  const services = svcRows;
  const paymentMethods = ['card', 'zelle', 'cash', 'venmo', 'cashapp'];
  const statuses = ['completed', 'completed', 'completed', 'completed', 'confirmed', 'confirmed', 'cancelled'];
  const times = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
  
  let apptCount = 0;
  const today = new Date();
  
  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) continue; // skip Sundays
    
    const dateStr = date.toISOString().slice(0, 10);
    // 3-8 appointments per day on weekdays, 6-12 on Saturdays
    const numAppts = dayOfWeek === 6 ? 6 + Math.floor(Math.random() * 6) : 3 + Math.floor(Math.random() * 5);
    
    const usedTimes = new Set();
    for (let i = 0; i < numAppts; i++) {
      const client = clientLocalIds[Math.floor(Math.random() * clientLocalIds.length)];
      const svc = services[Math.floor(Math.random() * services.length)];
      let time = times[Math.floor(Math.random() * times.length)];
      // avoid exact duplicates
      let attempts = 0;
      while (usedTimes.has(time) && attempts < 10) {
        time = times[Math.floor(Math.random() * times.length)];
        attempts++;
      }
      usedTimes.add(time);
      
      const status = daysAgo > 0 
        ? statuses[Math.floor(Math.random() * statuses.length)]
        : (Math.random() > 0.3 ? 'confirmed' : 'pending');
      
      const paymentMethod = status === 'completed' 
        ? paymentMethods[Math.floor(Math.random() * paymentMethods.length)]
        : 'unpaid';
      const paymentStatus = status === 'completed' ? 'paid' : 'unpaid';
      
      // Add slight price variation
      const basePrice = parseFloat(svc.price);
      const price = (basePrice + (Math.random() > 0.7 ? 15 : 0)).toFixed(2);
      
      const localId = `appt-demo-${dateStr}-${i}-${Math.random().toString(36).slice(2,6)}`;
      
      await conn.execute(
        `INSERT INTO appointments 
         (businessOwnerId, localId, serviceLocalId, clientLocalId, date, time, duration, status, totalPrice, paymentMethod, paymentStatus, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
        [OWNER_ID, localId, svc.localId, client.localId, dateStr, time, svc.duration, status, price, paymentMethod, paymentStatus]
      );
      apptCount++;
    }
  }
  
  console.log(`Inserted ${apptCount} appointments`);
  
  // Update business owner to be visible in client portal
  await conn.execute(
    `UPDATE business_owners SET 
     clientPortalVisible = 1, 
     businessCategory = 'Massage,Skin,Wellness',
     businessDescription = 'Premium wellness studio offering therapeutic massages, advanced facials, and holistic body treatments. Our expert therapists create personalized experiences to restore balance and rejuvenate your body and mind.',
     address = '1247 Liberty Ave, Pittsburgh, PA 15222',
     updatedAt = NOW()
     WHERE id = ?`,
    [OWNER_ID]
  );
  
  console.log('Updated business owner portal visibility');
  await conn.end();
  console.log('Done!');
}

run().catch(e => { console.error(e); process.exit(1); });
