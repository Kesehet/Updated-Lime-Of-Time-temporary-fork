"""
Fix: Revert fs.* font size references inside StyleSheet.create() blocks back to
their original numeric values. StyleSheet.create() runs at module load time,
before any React hook (including useResponsive) is called, so fs.* is undefined
there and causes a Hermes GC crash.

fs.* values are ONLY valid inside component render functions (inline styles).

Mapping (phone values — the baseline):
  fs.xs  -> 11
  fs.sm  -> 13
  fs.md  -> 15
  fs.lg  -> 17
  fs.xl  -> 20
  fs.xxl -> 24
  fs.hero -> 32
"""

import re
import glob

FS_MAP = {
    'fs.xs': '11',
    'fs.sm': '13',
    'fs.md': '15',
    'fs.lg': '17',
    'fs.xl': '20',
    'fs.xxl': '24',
    'fs.hero': '32',
}

def revert_fs_in_stylesheet(content):
    """Find all StyleSheet.create blocks and revert fs.* to numeric values."""
    result = list(content)
    changes = 0
    
    for match in re.finditer(r'StyleSheet\.create\s*\(', content):
        # Find the matching closing paren
        start = match.end()
        depth = 1
        i = start
        while i < len(content) and depth > 0:
            if content[i] == '(':
                depth += 1
            elif content[i] == ')':
                depth -= 1
            i += 1
        block_end = i
        
        block = content[start:block_end]
        
        if 'fs.' not in block:
            continue
        
        # Replace fs.* with numeric values in this block
        new_block = block
        for fs_key, num_val in FS_MAP.items():
            # Replace fontSize: fs.xs etc.
            pattern = r'fontSize:\s*' + re.escape(fs_key) + r'(?=[,\s}])'
            replacement = f'fontSize: {num_val}'
            new_block, n = re.subn(pattern, replacement, new_block)
            changes += n
        
        if new_block != block:
            # Replace in result
            result[start:block_end] = list(new_block)
            # Recalculate positions - easier to just do string replacement
    
    # Simpler approach: do it on the whole content but only within StyleSheet.create blocks
    return None, changes

def revert_fs_in_stylesheet_v2(content):
    """Find all StyleSheet.create blocks and revert fs.* to numeric values."""
    changes = 0
    output = content
    
    # Find all StyleSheet.create blocks
    offset = 0
    result_parts = []
    
    for match in re.finditer(r'StyleSheet\.create\s*\(', content):
        # Add content before this match
        result_parts.append(content[offset:match.end()])
        
        # Find the matching closing paren
        start = match.end()
        depth = 1
        i = start
        while i < len(content) and depth > 0:
            if content[i] == '(':
                depth += 1
            elif content[i] == ')':
                depth -= 1
            i += 1
        block_end = i
        
        block = content[start:block_end]
        
        # Replace fs.* with numeric values in this block
        new_block = block
        for fs_key, num_val in FS_MAP.items():
            pattern = r'fontSize:\s*' + re.escape(fs_key) + r'(?=[,\s}])'
            replacement = f'fontSize: {num_val}'
            new_block, n = re.subn(pattern, replacement, new_block)
            changes += n
        
        result_parts.append(new_block)
        offset = block_end
    
    # Add remaining content
    result_parts.append(content[offset:])
    
    return ''.join(result_parts), changes


# Process all TSX files
files = glob.glob('/home/ubuntu/manus-scheduler/app/**/*.tsx', recursive=True)

total_changes = 0
modified_files = []

for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    
    if 'StyleSheet.create' not in original or 'fs.' not in original:
        continue
    
    new_content, changes = revert_fs_in_stylesheet_v2(original)
    
    if changes > 0 and new_content != original:
        with open(filepath, 'w') as f:
            f.write(new_content)
        total_changes += changes
        rel_path = filepath.replace('/home/ubuntu/manus-scheduler/', '')
        modified_files.append((rel_path, changes))
        print(f"  {rel_path}: {changes} reversions")

print(f"\nTotal: {total_changes} fs.* reversions in StyleSheet.create blocks across {len(modified_files)} files")
