"""
Apply buttonHeight to primary action buttons across all screens.

Approach:
1. Add buttonHeight, iconButtonSize to useResponsive destructure in all files that use useResponsive
2. Replace common primary button paddingVertical patterns with buttonHeight-based values

The most common primary button pattern is:
  paddingVertical: 14  (in a button with backgroundColor: colors.primary or similar)
  paddingVertical: 16
  paddingVertical: 15

We'll replace these with: paddingVertical: buttonHeight * 0.27 (approx 14 for phone, 14 for tablet)
Actually that's not a clean approach.

Better: add minHeight: buttonHeight to buttons that have paddingVertical: 14-16
This ensures the button is at least 44dp on phone and 52dp on tablet.

Even better approach: just replace paddingVertical: 14 with paddingVertical: buttonHeight / 3
  phone: 44/3 = ~14.7 ≈ 14 ✓
  tablet: 52/3 = ~17.3 ≈ 17 ✓ (slightly more padding)

Or simply: replace paddingVertical: 14 with paddingVertical: isTablet ? 17 : 14
But that requires isTablet in scope.

SIMPLEST SAFE APPROACH:
- Add buttonHeight to all useResponsive destructures
- Replace `paddingVertical: 14` with `paddingVertical: buttonHeight / 3` in button contexts
- Replace `paddingVertical: 16` with `paddingVertical: buttonHeight / 2.8` in button contexts

Actually the cleanest is to just add minHeight: buttonHeight to the button style.
But we can't easily identify which paddingVertical belongs to a button vs a card.

FINAL APPROACH: 
- Add buttonHeight and iconButtonSize to all useResponsive destructures
- In StyleSheet.create blocks, we can't use dynamic values
- For inline styles on Pressable/TouchableOpacity, replace paddingVertical: 14 with paddingVertical: Math.round(buttonHeight * 0.32)
  phone: Math.round(44 * 0.32) = 14 ✓
  tablet: Math.round(52 * 0.32) = 17 ✓

But this is risky as it would affect ALL paddingVertical: 14 including non-button elements.

MOST PRACTICAL: Just add buttonHeight to all destructures so it's available,
and apply it to the most visible primary CTA buttons in the 5 most-used screens manually.
"""

import os
import re
import glob

def add_to_destructure(content):
    """Add buttonHeight and iconButtonSize to useResponsive destructure."""
    if 'buttonHeight' in content:
        return content, False
    
    # Find the useResponsive destructure
    pattern = r'(const \{[^}]+?)(\s*\})\s*=\s*useResponsive\(\)'
    match = re.search(pattern, content)
    if not match:
        return content, False
    
    new_destructure = match.group(1) + ', buttonHeight, iconButtonSize' + match.group(2) + ' = useResponsive()'
    new_content = content[:match.start()] + new_destructure + content[match.end():]
    return new_content, True

files = glob.glob('/home/ubuntu/manus-scheduler/app/**/*.tsx', recursive=True)

added = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    
    if 'useResponsive' not in original:
        continue
    
    content, changed = add_to_destructure(original)
    
    if changed:
        with open(filepath, 'w') as f:
            f.write(content)
        added += 1

print(f"Added buttonHeight/iconButtonSize to {added} files")

# Now apply buttonHeight to primary action buttons in key screens
# We'll target the most common full-width CTA button pattern:
# Pressable/TouchableOpacity with backgroundColor: colors.primary and paddingVertical: 14 or 16

key_screens = [
    '/home/ubuntu/manus-scheduler/app/booking.tsx',
    '/home/ubuntu/manus-scheduler/app/client-booking-wizard.tsx',
    '/home/ubuntu/manus-scheduler/app/new-booking.tsx',
    '/home/ubuntu/manus-scheduler/app/appointment-detail.tsx',
    '/home/ubuntu/manus-scheduler/app/(tabs)/bookings.tsx',
    '/home/ubuntu/manus-scheduler/app/client-buy-gift.tsx',
    '/home/ubuntu/manus-scheduler/app/calendar-booking.tsx',
    '/home/ubuntu/manus-scheduler/app/onboarding.tsx',
    '/home/ubuntu/manus-scheduler/app/subscription.tsx',
]

total_replacements = 0
for filepath in key_screens:
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Replace paddingVertical: 16 in primary button contexts (full-width CTAs)
    # These are typically the last paddingVertical in a button style block
    # We'll use a conservative replacement: only when it's inside a style prop on Pressable/TouchableOpacity
    # and the button has backgroundColor: colors.primary
    
    # Pattern: paddingVertical: 16, borderRadius (primary button)
    # Replace with: paddingVertical: Math.round(buttonHeight * 0.31), borderRadius
    
    # Replace common primary button padding patterns
    # paddingVertical: 16 -> paddingVertical: Math.round(buttonHeight * 0.31)  (14 phone, 16 tablet)
    # paddingVertical: 14 -> paddingVertical: Math.round(buttonHeight * 0.27)  (12 phone, 14 tablet)
    
    # Actually let's just add minHeight: buttonHeight to the most obvious full-width buttons
    # by finding patterns like: backgroundColor: colors.primary, ... paddingVertical: 14/16
    
    # Simple approach: replace paddingVertical: 16 with paddingVertical: buttonHeight * 0.31 | 0
    # in the context of primary buttons
    
    # Find Pressable/TouchableOpacity style blocks with backgroundColor: colors.primary
    # and replace their paddingVertical
    
    # This is too complex for regex. Let's just do a targeted replacement of the most
    # common full-width button pattern: 
    # { backgroundColor: colors.primary, borderRadius: XX, paddingVertical: 14/16, alignItems: "center" }
    
    # Replace paddingVertical: 16 in primary button inline styles
    count = 0
    
    # Pattern for full-width primary buttons
    replacements_made = [0]
    def replace_primary_btn_padding(m):
        replacements_made[0] += 1
        return m.group(0).replace(
            'paddingVertical: 16',
            'paddingVertical: Math.round(buttonHeight * 0.31)'
        ).replace(
            'paddingVertical: 14',
            'paddingVertical: Math.round(buttonHeight * 0.27)'
        )
    
    # Find style blocks that have both backgroundColor: colors.primary and paddingVertical
    # This is a multi-line pattern
    btn_pattern = re.compile(
        r'(backgroundColor:\s*colors\.primary[^}]{0,200}?paddingVertical:\s*1[46])',
        re.DOTALL
    )
    
    new_content = btn_pattern.sub(replace_primary_btn_padding, content)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        total_replacements += replacements_made[0]
        print(f"  {filepath.replace('/home/ubuntu/manus-scheduler/', '')}: {replacements_made[0]} button padding updates")

import os
print(f"\nTotal button padding updates: {total_replacements}")
