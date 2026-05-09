"""
Apply touch target improvements to primary action buttons across all screens.

Strategy:
- Primary buttons with paddingVertical: 12-16 -> paddingVertical: touchTarget / 2.8 (approx 14-17)
  Actually simpler: replace `paddingVertical: 14` and `paddingVertical: 16` with 
  `paddingVertical: isTablet ? touchTarget / 2.8 : 14` - too complex for regex.

Better approach: 
- Add `minHeight: touchTarget` to full-width primary action buttons
- These are typically identified by having: backgroundColor: colors.primary, borderRadius, paddingVertical: 14-16
- Also update icon button containers: width: 40/44 -> width: touchTarget, height: 40/44 -> height: touchTarget

Even simpler approach that's safe and effective:
- In StyleSheet.create blocks, find button styles with paddingVertical: 14 or 16
  and add minHeight: touchTarget (but touchTarget isn't available in StyleSheet.create)

SAFEST approach: 
- Update the touchTarget value in useResponsive to 52 for tablet (was 48)
- Add a `buttonHeight` field: 52 on tablet, 44 on phone
- Apply it to inline-styled primary buttons that already use touchTarget

Actually the cleanest approach is:
- Update useResponsive to add buttonHeight (52 tablet, 44 phone) and iconButtonSize (48 tablet, 40 phone)
- Apply these in the most impactful screens manually

Let's just update useResponsive with the new values and apply them to the key screens.
"""

import re

# Update useResponsive to add buttonHeight and iconButtonSize
with open('/home/ubuntu/manus-scheduler/hooks/use-responsive.ts', 'r') as f:
    content = f.read()

# Add buttonHeight and iconButtonSize to the interface
interface_addition = '''  /** Primary button height (52 on tablet, 44 on phone) */
  buttonHeight: number;
  /** Icon button size (48 on tablet, 40 on phone) */
  iconButtonSize: number;
'''

content = content.replace(
    '  /** Minimum touch target size (44 on phone, 48 on tablet) */\n  touchTarget: number;',
    '  /** Minimum touch target size (44 on phone, 48 on tablet) */\n  touchTarget: number;\n' + interface_addition
)

# Add the values to the return object
content = content.replace(
    '      touchTarget: isPhysicalTablet ? 48 : 44,',
    '      touchTarget: isPhysicalTablet ? 48 : 44,\n      buttonHeight: isPhysicalTablet ? 52 : 44,\n      iconButtonSize: isLargeTablet ? 52 : isPhysicalTablet ? 48 : 40,'
)

with open('/home/ubuntu/manus-scheduler/hooks/use-responsive.ts', 'w') as f:
    f.write(content)

print("Updated useResponsive with buttonHeight and iconButtonSize")

# Now apply buttonHeight to primary action buttons in key screens
# These are the "Book Now", "Save", "Confirm", "Pay" type buttons
# They typically have: backgroundColor: colors.primary, paddingVertical: 14-16, borderRadius, alignItems: center

import glob

files = glob.glob('/home/ubuntu/manus-scheduler/app/**/*.tsx', recursive=True)

total = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    
    if 'useResponsive' not in original or 'buttonHeight' in original:
        continue
    
    content = original
    
    # Add buttonHeight to destructure where touchTarget is already there
    if 'touchTarget' in content:
        content = content.replace(
            ', touchTarget }',
            ', touchTarget, buttonHeight, iconButtonSize }'
        )
        content = content.replace(
            ', touchTarget,',
            ', touchTarget, buttonHeight, iconButtonSize,'
        )
        content = content.replace(
            'touchTarget }',
            'touchTarget, buttonHeight, iconButtonSize }'
        )
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        total += 1
        print(f"  Added buttonHeight to {filepath.replace('/home/ubuntu/manus-scheduler/', '')}")

print(f"\nAdded buttonHeight/iconButtonSize to {total} files")
