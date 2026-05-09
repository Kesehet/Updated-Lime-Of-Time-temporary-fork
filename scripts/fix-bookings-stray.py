"""
Removes the stray old content that was left in the render section of bookings.tsx
after the first fix script ran. The stray block starts at the orphaned </View>
after the split-view closing )} and ends at the old </ScrollView> before the
Payment Method Modal comment.
"""

with open('app/(tabs)/bookings.tsx', 'r') as f:
    lines = f.readlines()

# Find the line with "      )}" that closes the split-view ternary
# followed by the stray "        </View>"
stray_start = None
for i, line in enumerate(lines):
    if '      )}' in line and i + 1 < len(lines) and '        </View>' in lines[i + 1]:
        stray_start = i + 1  # the stray </View> line (0-indexed)
        break

if stray_start is None:
    print("ERROR: Could not find stray </View> after split-view closing")
    # Try alternative: find the orphaned </View> between )} and {/* Method sub-filter
    for i, line in enumerate(lines):
        if '        </View>' in line:
            # Check if previous non-empty line is "      )}"
            prev = i - 1
            while prev >= 0 and not lines[prev].strip():
                prev -= 1
            if '      )}' in lines[prev]:
                stray_start = i
                print(f"Found stray </View> at line {i+1}")
                break

if stray_start is None:
    print("ERROR: Could not find stray block start")
    exit(1)

print(f"Stray block starts at line {stray_start + 1}: {lines[stray_start][:60]}")

# Find the old </ScrollView> that closes the stray appointment list block
# It's the one right before "{/* Payment Method Modal */"
stray_end = None
for i in range(stray_start, len(lines)):
    if '{/* Payment Method Modal */' in lines[i]:
        # The </ScrollView> is the line before this
        stray_end = i - 1
        # Skip blank lines
        while stray_end > stray_start and not lines[stray_end].strip():
            stray_end -= 1
        break

if stray_end is None:
    print("ERROR: Could not find end of stray block")
    exit(1)

print(f"Stray block ends at line {stray_end + 1}: {lines[stray_end][:60]}")
print(f"Removing {stray_end - stray_start + 1} lines")

# Remove the stray block
new_lines = lines[:stray_start] + lines[stray_end + 1:]

with open('app/(tabs)/bookings.tsx', 'w') as f:
    f.writelines(new_lines)

print(f"Done! Original: {len(lines)} lines, New: {len(new_lines)} lines")
