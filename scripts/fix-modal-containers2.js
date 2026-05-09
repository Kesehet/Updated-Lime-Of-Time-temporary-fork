/**
 * fix-modal-containers2.js
 * 
 * Applies maxWidth constraints to modal/sheet inner containers across all screens.
 * Handles both:
 * 1. StyleSheet.create patterns: adds maxWidth and alignSelf to the modalContent style
 * 2. Inline style patterns: adds maxWidth and alignSelf to the inner View
 */
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/ubuntu/manus-scheduler';

const screens = [
  'app/(tabs)/bookings.tsx',
  'app/(tabs)/calendar.tsx',
  'app/(tabs)/clients.tsx',
  'app/(tabs)/gifts.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/services.tsx',
  'app/(tabs)/settings.tsx',
  'app/(client-tabs)/messages.tsx',
  'app/client-business-detail.tsx',
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

let totalPatched = 0;

for (const relPath of screens) {
  const fullPath = path.join(PROJECT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log('SKIP (not found):', relPath);
    continue;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const before = content;
  
  // Pattern 1: StyleSheet.create modalContent style (multi-line)
  // Find: modalContent: { borderTopLeftRadius: N, borderTopRightRadius: N, ...padding... }
  // Add: width: '100%', maxWidth: 560, alignSelf: 'center' if not already there
  content = content.replace(
    /(modalContent:\s*\{[^}]*borderTopLeftRadius:\s*\d+[^}]*borderTopRightRadius:\s*\d+[^}]*\})/gs,
    (match) => {
      if (match.includes('maxWidth')) return match;
      // Insert before closing brace
      return match.replace(/(\s*\},?\s*)$/, ',\n    width: \'100%\',\n    maxWidth: 560,\n    alignSelf: \'center\' as const,$1');
    }
  );

  // Pattern 2: StyleSheet.create with borderTopLeft/Right on separate lines
  content = content.replace(
    /(  \w+Content:\s*\{[\s\S]*?borderTopLeftRadius:\s*\d+,[\s\S]*?borderTopRightRadius:\s*\d+,[\s\S]*?\},)/g,
    (match) => {
      if (match.includes('maxWidth')) return match;
      if (!match.includes('padding')) return match;
      return match.replace(/(\s*\},)$/, ',\n    width: \'100%\',\n    maxWidth: 560,\n    alignSelf: \'center\' as const,$1'.replace(',$1', '$1'));
    }
  );
  
  if (content !== before) {
    fs.writeFileSync(fullPath, content);
    console.log('PATCHED:', relPath);
    totalPatched++;
  }
}

console.log('\nDone:', totalPatched, 'files patched');
