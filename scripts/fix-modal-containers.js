/**
 * fix-modal-containers.js
 * 
 * Applies maxWidth: modalMaxWidth, alignSelf: 'center' to all bottom-sheet
 * inner containers across all screens. This ensures modals don't stretch
 * edge-to-edge on tablets.
 * 
 * Pattern targeted: 
 *   backgroundColor: colors.background/surface, borderTopLeftRadius: 24/20, borderTopRightRadius: 24/20
 *   that DON'T already have maxWidth set
 */
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/ubuntu/manus-scheduler';

// All screens to process
const screens = [
  'app/(tabs)/bookings.tsx',
  'app/(tabs)/calendar.tsx',
  'app/(tabs)/clients.tsx',
  'app/(tabs)/gifts.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/services.tsx',
  'app/(tabs)/settings.tsx',
  'app/(client-tabs)/messages.tsx',
  'app/appointment-detail.tsx',
  'app/client-business-detail.tsx',
  'app/client-buy-gift.tsx',
  'app/client-detail.tsx',
  'app/discounts.tsx',
  'app/edit-appointment.tsx',
  'app/gift-cards.tsx',
  'app/gift/[code].tsx',
  'app/location-form.tsx',
  'app/locations.tsx',
  'app/new-booking.tsx',
  'app/packages.tsx',
  'app/product-form.tsx',
  'app/reviews.tsx',
  'app/schedule-settings.tsx',
  'app/service-form.tsx',
  'app/staff-form.tsx',
  'app/staff.tsx',
  'app/subscription.tsx',
];

// Regex to find bottom-sheet inner containers WITHOUT maxWidth already set
// Matches: { backgroundColor: colors.X, borderTopLeftRadius: N, borderTopRightRadius: N, ...padding...}
// but NOT if it already has maxWidth

function applyMaxWidthToSheets(content, file) {
  let changeCount = 0;
  
  // Pattern 1: borderTopLeftRadius: 24, borderTopRightRadius: 24
  // Pattern 2: borderTopLeftRadius: 20, borderTopRightRadius: 20
  const patterns = [
    // backgroundColor: colors.X, borderTopLeftRadius: 24, borderTopRightRadius: 24
    /(\{ backgroundColor: colors\.\w+, borderTopLeftRadius: \d+, borderTopRightRadius: \d+, [^}]*\})/g,
    // backgroundColor: colors.X, borderTopLeftRadius: 24, borderTopRightRadius: 24 (with padding variants)
    /(\{ borderTopLeftRadius: \d+, borderTopRightRadius: \d+, backgroundColor: colors\.\w+, [^}]*\})/g,
  ];
  
  for (const pattern of patterns) {
    content = content.replace(pattern, (match) => {
      // Skip if already has maxWidth
      if (match.includes('maxWidth')) return match;
      // Skip if it's a SafeAreaView or similar (no padding)
      if (!match.includes('padding')) return match;
      
      // Insert maxWidth before the closing brace
      const insertion = ", width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center'";
      const result = match.slice(0, -1) + insertion + '}';
      if (result !== match) changeCount++;
      return result;
    });
  }
  
  if (changeCount > 0) {
    console.log(`  Applied ${changeCount} sheet maxWidth fixes in: ${file}`);
  }
  return content;
}

let totalPatched = 0;

for (const relPath of screens) {
  const fullPath = path.join(PROJECT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log('SKIP (not found):', relPath);
    continue;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const before = content;
  
  content = applyMaxWidthToSheets(content, relPath);
  
  if (content !== before) {
    fs.writeFileSync(fullPath, content);
    console.log('PATCHED:', relPath);
    totalPatched++;
  }
}

console.log('\nDone:', totalPatched, 'files patched');
