import { db as dbase } from '../server/db.js';
import { businessOwners, clientAccounts, clients, appointments } from '../drizzle/schema.ts';
import { like, or } from 'drizzle-orm';

// Check business owners
const owners = await dbase.select({ id: businessOwners.id, name: businessOwners.businessName, phone: businessOwners.phone }).from(businessOwners);
console.log('=== Business Owners ===');
owners.forEach(o => console.log(JSON.stringify(o)));

// Check clientAccounts
const accounts = await dbase.select().from(clientAccounts);
console.log('\n=== Client Accounts ===');
accounts.forEach(a => console.log(JSON.stringify(a)));

// Check clients table for this phone
const clientRows = await dbase.select({ id: clients.id, name: clients.name, phone: clients.phone, localId: clients.localId, businessOwnerId: clients.businessOwnerId }).from(clients).where(
  or(like(clients.phone, '%4124827733%'), like(clients.phone, '%482-7733%'), like(clients.phone, '%4827733%'))
);
console.log('\n=== Clients with 412-482-7733 ===');
clientRows.forEach(c => console.log(JSON.stringify(c)));

// Check all clients
const allClients = await dbase.select({ id: clients.id, name: clients.name, phone: clients.phone, localId: clients.localId, businessOwnerId: clients.businessOwnerId }).from(clients);
console.log('\n=== All Clients ===');
allClients.forEach(c => console.log(JSON.stringify(c)));

// Check appointments
const appts = await dbase.select({ id: appointments.id, clientLocalId: appointments.clientLocalId, date: appointments.date, status: appointments.status, businessOwnerId: appointments.businessOwnerId }).from(appointments);
console.log('\n=== Appointments ===');
appts.forEach(a => console.log(JSON.stringify(a)));

process.exit(0);
