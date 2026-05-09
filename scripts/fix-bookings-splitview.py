"""
Restructures bookings.tsx for the split-view pattern:
1. Extracts the list content (Header, Calendar, Filters, Appointment list)
   into a `listContent` JSX variable above the return statement.
2. Removes the old duplicated block that was left in the render section.
"""
import re

with open('app/(tabs)/bookings.tsx', 'r') as f:
    content = f.read()
    lines = content.split('\n')

# ── Step 1: Find the old duplicated block boundaries ──────────────────────
# The old block starts at the line "        {/* Header */" (the second occurrence)
# and ends at "      </ScrollView>" (the one at line 1150)

# Find all occurrences of "{/* Header */"
header_occurrences = [i for i, l in enumerate(lines) if '{/* Header */' in l]
print(f"Header occurrences at lines: {[i+1 for i in header_occurrences]}")

# The second occurrence is the old duplicated block
if len(header_occurrences) < 2:
    print("ERROR: Could not find second Header occurrence")
    exit(1)

old_start = header_occurrences[1]  # 0-indexed

# Find the closing </ScrollView> after old_start
scroll_view_closes = [i for i, l in enumerate(lines) if '      </ScrollView>' in l and i > old_start]
print(f"ScrollView closes after old_start: {[i+1 for i in scroll_view_closes[:5]]}")

old_end = scroll_view_closes[0]  # 0-indexed, inclusive

print(f"Old block: lines {old_start+1} to {old_end+1}")
print(f"Old block starts: {lines[old_start][:80]}")
print(f"Old block ends: {lines[old_end][:80]}")

# ── Step 2: Extract the old block content ─────────────────────────────────
old_block_lines = lines[old_start:old_end+1]

# ── Step 3: Build the listContent JSX variable ────────────────────────────
# The old block is indented with 8 spaces (inside ScrollView > contentContainer)
# We want it indented with 4 spaces (inside the listContent = ( <> ... </> ) )
list_content_parts = ['  const listContent = (', '    <>']
for line in old_block_lines:
    # Remove 6 leading spaces (old indent was 8, new is 6 inside the fragment)
    if line.startswith('        '):
        list_content_parts.append('      ' + line[8:])
    elif line.startswith('      '):
        list_content_parts.append('    ' + line[6:])
    else:
        list_content_parts.append(line)
list_content_parts.append('    </>')
list_content_parts.append('  );')
list_content_parts.append('')

list_content_var = '\n'.join(list_content_parts)

# ── Step 4: Find insertion point (before "// ─── Render ───") ─────────────
render_comment_idx = None
for i, line in enumerate(lines):
    if '// ─── Render ───' in line:
        render_comment_idx = i
        break

if render_comment_idx is None:
    print("ERROR: Could not find render comment")
    exit(1)

print(f"Inserting listContent before line {render_comment_idx+1}")

# ── Step 5: Build the new file ────────────────────────────────────────────
new_lines = (
    lines[:render_comment_idx]
    + list_content_var.split('\n')
    + lines[render_comment_idx:old_start]
    + lines[old_end+1:]
)

new_content = '\n'.join(new_lines)

with open('app/(tabs)/bookings.tsx', 'w') as f:
    f.write(new_content)

print("Done! Wrote updated bookings.tsx")
print(f"Original lines: {len(lines)}, New lines: {len(new_lines)}")
