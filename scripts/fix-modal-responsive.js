/**
 * fix-modal-responsive.js
 * 
 * Adds useResponsive import + modalMaxWidth to all screens that have Modals
 * but are missing responsive modal width constraints.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/ubuntu/manus-scheduler';

// Screens that need useResponsive added + modalMaxWidth destructured
const screensNeedingResponsive = [
  'app/(client-tabs)/messages.tsx',
  'app/client-business-detail.tsx',
  'app/client-buy-gift.tsx',
  'app/subscription.tsx',
];

// Screens that already have useResponsive but need modalMaxWidth added to destructure
const screensNeedingModalMaxWidth = [
  'app/(tabs)/clients.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/services.tsx',
  'app/(tabs)/settings.tsx',
  'app/client-detail.tsx',
  'app/edit-appointment.tsx',
  'app/packages.tsx',
  'app/service-form.tsx',
  'app/staff.tsx',
  'app/locations.tsx',
  'app/reviews.tsx',
  'app/booking.tsx',
  'app/new-booking.tsx',
];

function addResponsiveImport(content) {
  // Add useResponsive import if not present
  if (content.includes('useResponsive')) return content;
  
  // Find the last import line and add after it
  const useColorsImport = "import { useColors } from \"@/hooks/use-colors\";";
  const useColorsImport2 = "import { useColors } from '@/hooks/use-colors';";
  
  if (content.includes(useColorsImport)) {
    return content.replace(
      useColorsImport,
      useColorsImport + '\nimport { useResponsive } from "@/hooks/use-responsive";'
    );
  } else if (content.includes(useColorsImport2)) {
    return content.replace(
      useColorsImport2,
      useColorsImport2 + "\nimport { useResponsive } from '@/hooks/use-responsive';"
    );
  }
  return content;
}

function addModalMaxWidthToDestructure(content, file) {
  // Try common patterns for useResponsive destructuring
  const patterns = [
    /const \{ ([^}]+) \} = useResponsive\(\);/,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const existing = match[1];
      if (existing.includes('modalMaxWidth')) {
        console.log('  Already has modalMaxWidth:', file);
        return content;
      }
      const newDestructure = existing.trim() + ', modalMaxWidth';
      return content.replace(match[0], `const { ${newDestructure} } = useResponsive();`);
    }
  }
  
  // If no useResponsive call found, add one after useColors
  const colorsPattern = /const colors = useColors\(\);/;
  if (colorsPattern.test(content)) {
    return content.replace(
      colorsPattern,
      'const colors = useColors();\n  const { modalMaxWidth } = useResponsive();'
    );
  }
  
  console.log('  WARNING: Could not find useResponsive call in:', file);
  return content;
}

let totalPatched = 0;

// Step 1: Add useResponsive to screens that don't have it
for (const relPath of screensNeedingResponsive) {
  const fullPath = path.join(PROJECT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log('SKIP (not found):', relPath);
    continue;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const before = content;
  
  content = addResponsiveImport(content);
  content = addModalMaxWidthToDestructure(content, relPath);
  
  if (content !== before) {
    fs.writeFileSync(fullPath, content);
    console.log('PATCHED (added useResponsive):', relPath);
    totalPatched++;
  } else {
    console.log('NO CHANGE:', relPath);
  }
}

// Step 2: Add modalMaxWidth to screens that already have useResponsive
for (const relPath of screensNeedingModalMaxWidth) {
  const fullPath = path.join(PROJECT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log('SKIP (not found):', relPath);
    continue;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const before = content;
  
  content = addModalMaxWidthToDestructure(content, relPath);
  
  if (content !== before) {
    fs.writeFileSync(fullPath, content);
    console.log('PATCHED (added modalMaxWidth):', relPath);
    totalPatched++;
  } else {
    console.log('NO CHANGE:', relPath);
  }
}

console.log('\nDone:', totalPatched, 'files patched');
