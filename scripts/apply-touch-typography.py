"""
Apply touch target and responsive typography improvements to all screens.

Step 1: Add `fs` to the useResponsive destructure in all screens that use useResponsive
Step 2: Replace hardcoded fontSize values with fs.* equivalents
"""

import os
import re
import glob

def add_fs_to_destructure(content):
    """Add fs to the useResponsive destructure if not already there."""
    if ', fs,' in content or ', fs }' in content or ', fs\n' in content or 'fs,' in content:
        return content, False
    
    # Pattern: const { ..., someVar } = useResponsive();
    # We need to add fs to the destructure
    pattern = r'(const \{[^}]+?)(\s*\})\s*=\s*useResponsive\(\)'
    match = re.search(pattern, content)
    if not match:
        return content, False
    
    # Add fs before the closing brace
    new_destructure = match.group(1) + ', fs' + match.group(2) + ' = useResponsive()'
    new_content = content[:match.start()] + new_destructure + content[match.end():]
    return new_content, True

def apply_typography(content):
    """Replace hardcoded fontSize values with fs.* equivalents where safe."""
    changes = 0
    
    replacements = [
        # Hero/page titles: 28, 30, 32 -> fs.xxl
        (r'fontSize:\s*3[02](?=[,\s}])', 'fontSize: fs.xxl'),
        # Section headers, card titles: 24, 26 -> fs.xl  
        (r'fontSize:\s*2[46](?=[,\s}])', 'fontSize: fs.xl'),
        # Sub-headers, prominent labels: 20, 22 -> fs.lg
        (r'fontSize:\s*2[02](?=[,\s}])', 'fontSize: fs.lg'),
        # Body text, button labels: 16, 17, 18 -> fs.md
        (r'fontSize:\s*1[678](?=[,\s}])', 'fontSize: fs.md'),
        # Secondary text, captions: 14, 15 -> fs.sm
        (r'fontSize:\s*1[45](?=[,\s}])', 'fontSize: fs.sm'),
        # Small labels, badges: 11, 12, 13 -> fs.xs
        (r'fontSize:\s*1[123](?=[,\s}])', 'fontSize: fs.xs'),
    ]
    
    for pattern, replacement in replacements:
        new_content, n = re.subn(pattern, replacement, content)
        if n > 0:
            content = new_content
            changes += n
    
    return content, changes

# Get all TSX files in app directory
files = glob.glob('/home/ubuntu/manus-scheduler/app/**/*.tsx', recursive=True)

total_changes = 0
modified_files = []
fs_added = []

for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    
    if 'useResponsive' not in original:
        continue
    
    content = original
    
    # Step 1: Add fs to destructure if needed
    content, added = add_fs_to_destructure(content)
    if added:
        fs_added.append(filepath.replace('/home/ubuntu/manus-scheduler/', ''))
    
    # Step 2: Apply typography replacements (only if fs is now available)
    if 'fs,' in content or ', fs }' in content or ', fs\n' in content or ', fs,' in content:
        content, changes = apply_typography(content)
    else:
        changes = 0
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        total_changes += changes
        rel_path = filepath.replace('/home/ubuntu/manus-scheduler/', '')
        modified_files.append((rel_path, changes))
        if changes > 0:
            print(f"  {rel_path}: {changes} font replacements")

print(f"\nAdded fs to destructure in {len(fs_added)} files")
print(f"Total: {total_changes} font size replacements across {len(modified_files)} files")
