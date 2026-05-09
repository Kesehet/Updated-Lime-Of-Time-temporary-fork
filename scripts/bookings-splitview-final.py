"""
Implements the two-column split-view for bookings.tsx in one clean pass.
Approach:
  1. Add `useSideBySide, touchTarget` to useResponsive destructure
  2. Add `selectedAppt` state variable after existing state vars
  3. Extract the ScrollView content (lines 666-983) into a `listContent` variable
  4. Add `renderDetailPanel` function before the return statement
  5. Replace the single ScrollView (lines 661-984) with the split-view structure
"""

with open('app/(tabs)/bookings.tsx', 'r') as f:
    lines = f.readlines()

total = len(lines)
print(f"Total lines: {total}")

# ── 1. Update useResponsive destructure ──────────────────────────────────
for i, line in enumerate(lines):
    if 'const { hp, width, maxContentWidth, isTablet, fs, modalMaxWidth } = useResponsive();' in line:
        lines[i] = line.replace(
            'const { hp, width, maxContentWidth, isTablet, fs, modalMaxWidth } = useResponsive();',
            'const { hp, width, maxContentWidth, isTablet, fs, modalMaxWidth, useSideBySide, touchTarget } = useResponsive();'
        )
        print(f"Updated useResponsive at line {i+1}")
        break

# ── 2. Add selectedAppt state after packageGroupFilter state ─────────────
for i, line in enumerate(lines):
    if "const [packageGroupFilter, setPackageGroupFilter] = useState<string | null>(params.packageGroupId ?? null);" in line:
        insert_state = (
            '\n'
            '  // Split-view: selected appointment for the right panel on tablet landscape\n'
            '  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);\n'
        )
        lines.insert(i + 1, insert_state)
        print(f"Inserted selectedAppt state after line {i+1}")
        break

# Re-read line numbers after insertion
with open('/tmp/bookings_temp.tsx', 'w') as f:
    f.writelines(lines)

# ── 3. Find the exact boundaries of the ScrollView + its content ──────────
# ScrollView starts at line 661 (0-indexed: 660), content at 666 (0-indexed: 665)
# ScrollView ends at line 984 (0-indexed: 983)
# We need to find these dynamically after the insertion

scroll_start = None  # The <ScrollView line
scroll_end = None    # The </ScrollView> line (closing the main list ScrollView)
content_start = None # The {/* Header */} line

# Find the main ScrollView in the render section (after line 650)
for i, line in enumerate(lines):
    if i > 650 and '      <ScrollView' in line:
        # Check next line has ref={scrollRef}
        if i+1 < len(lines) and 'ref={scrollRef}' in lines[i+1]:
            scroll_start = i
            print(f"ScrollView starts at line {i+1}")
            break

# Find the main ScrollView closing tag: it's the line just before {/* Payment Method Modal */}
for i, line in enumerate(lines):
    if '{/* Payment Method Modal */' in line:
        # The </ScrollView> should be 2 lines before (with a blank line between)
        j = i - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        if '</ScrollView>' in lines[j]:
            scroll_end = j
            print(f"ScrollView ends at line {j+1}: {lines[j][:60]}")
        break

# The list content is everything between the ScrollView opening and closing
# (lines scroll_start+4 to scroll_end-1, i.e., after the contentContainerStyle prop)
# Actually the content starts at the first {/* Header */} after scroll_start
for i in range(scroll_start, scroll_end):
    if '{/* Header */' in lines[i]:
        content_start = i
        print(f"Content starts at line {i+1}")
        break

print(f"Extracting content: lines {content_start+1} to {scroll_end}")

# ── 4. Build the listContent variable ────────────────────────────────────
list_content_lines = ['  const listContent = (\n', '    <>\n']
for line in lines[content_start:scroll_end]:
    # The content is indented with 8 spaces; reduce to 6 for inside the fragment
    if line.startswith('        '):
        list_content_lines.append('      ' + line[8:])
    elif line.startswith('      '):
        list_content_lines.append('    ' + line[6:])
    elif line.startswith('    '):
        list_content_lines.append('  ' + line[4:])
    else:
        list_content_lines.append(line)
list_content_lines.append('    </>\n')
list_content_lines.append('  );\n')
list_content_lines.append('\n')

# ── 5. Build renderDetailPanel function ──────────────────────────────────
render_detail_fn = '''  // ─── Inline detail panel for split-view (tablet landscape) ─────────────
  const renderDetailPanel = () => {
    if (!selectedAppt) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <IconSymbol name="calendar.badge.clock" size={48} color={colors.border} />
          <Text style={{ fontSize: fs.md, color: colors.muted, marginTop: 16, textAlign: 'center', fontWeight: '500' }}>
            Select an appointment{\'\\n\'}to view details
          </Text>
        </View>
      );
    }
    const svc = getServiceById(selectedAppt.serviceId);
    const client = getClientById(selectedAppt.clientId);
    const staff = selectedAppt.staffId ? getStaffById(selectedAppt.staffId) : null;
    const statusColor =
      selectedAppt.status === \'confirmed\' ? \'#1B5E20\'
      : selectedAppt.status === \'pending\' ? \'#FF9800\'
      : selectedAppt.status === \'completed\' ? colors.primary
      : selectedAppt.status === \'no_show\' ? \'#F59E0B\'
      : \'#F44336\';
    const isRequest = selectedAppt.status === \'pending\';
    const isPaid = selectedAppt.paymentStatus === \'paid\';
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Header row */}
        <View style={{ flexDirection: \'row\', alignItems: \'center\', justifyContent: \'space-between\', marginBottom: 20 }}>
          <Text style={{ fontSize: fs.xl, fontWeight: \'800\', color: colors.foreground, flex: 1 }} numberOfLines={2}>
            {client?.name ?? \'Client\'}
          </Text>
          <Pressable
            onPress={() => router.push({ pathname: \'/appointment-detail\', params: { id: selectedAppt.id } })}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
              marginLeft: 12,
            })}
          >
            <Text style={{ color: \'#FFF\', fontSize: fs.sm, fontWeight: \'700\' }}>Full Details</Text>
          </Pressable>
        </View>

        {/* Service card */}
        <View style={{ backgroundColor: (svc?.color ?? colors.primary) + \'12\', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: \'row\', alignItems: \'center\', marginBottom: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: svc?.color ?? colors.primary, marginRight: 8 }} />
            <Text style={{ fontSize: fs.md, fontWeight: \'700\', color: colors.foreground, flex: 1 }} numberOfLines={2}>
              {svc ? getServiceDisplayName(svc) : \'Service\'}
            </Text>
          </View>
          <Text style={{ fontSize: fs.sm, color: colors.muted }}>
            {formatTime(selectedAppt.time)} · {selectedAppt.duration} min
          </Text>
          {selectedAppt.totalPrice != null && (
            <Text style={{ fontSize: fs.lg, fontWeight: \'800\', color: colors.foreground, marginTop: 8 }}>
              ${selectedAppt.totalPrice.toFixed(2)}
            </Text>
          )}
        </View>

        {/* Status + staff row */}
        <View style={{ flexDirection: \'row\', alignItems: \'center\', gap: 10, marginBottom: 16, flexWrap: \'wrap\' }}>
          <View style={{ backgroundColor: statusColor + \'18\', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: \'700\', color: statusColor, textTransform: \'capitalize\' }}>{selectedAppt.status.replace(\'_\', \' \')}</Text>
          </View>
          {isPaid && (
            <View style={{ backgroundColor: \'#22C55E18\', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: \'700\', color: \'#22C55E\' }}>Paid</Text>
            </View>
          )}
          {staff && (
            <View style={{ flexDirection: \'row\', alignItems: \'center\', gap: 6, backgroundColor: (staff.color || colors.primary) + \'18\', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: staff.color || colors.primary }} />
              <Text style={{ fontSize: fs.sm, fontWeight: \'600\', color: staff.color || colors.primary }}>{staff.name}</Text>
            </View>
          )}
        </View>

        {/* Date */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: fs.xs, fontWeight: \'600\', color: colors.muted, textTransform: \'uppercase\', letterSpacing: 0.8, marginBottom: 4 }}>Date & Time</Text>
          <Text style={{ fontSize: fs.md, fontWeight: \'600\', color: colors.foreground }}>
            {formatSectionDate(selectedAppt.date)}
          </Text>
          <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 2 }}>
            {formatTime(selectedAppt.time)} · {selectedAppt.duration} min
          </Text>
        </View>

        {/* Notes */}
        {selectedAppt.notes ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: fs.xs, fontWeight: \'600\', color: colors.muted, textTransform: \'uppercase\', letterSpacing: 0.8, marginBottom: 4 }}>Notes</Text>
            <Text style={{ fontSize: fs.sm, color: colors.foreground }}>{selectedAppt.notes}</Text>
          </View>
        ) : null}

        {/* Quick actions */}
        <View style={{ gap: 10 }}>
          {!isPaid && selectedAppt.status !== \'cancelled\' && (
            <Pressable
              onPress={() => { setPayModalAppt(selectedAppt); setPayModalMethod(\'cash\'); }}
              style={({ pressed }) => ({
                backgroundColor: \'#22C55E\',
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: \'center\',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: \'#FFF\', fontSize: fs.md, fontWeight: \'700\' }}>Mark as Paid</Text>
            </Pressable>
          )}
          {isRequest && (
            <View style={{ flexDirection: \'row\', gap: 10 }}>
              <Pressable
                onPress={() => handleAccept(selectedAppt)}
                style={({ pressed }) => ({
                  flex: 1, backgroundColor: \'#1B5E20\', borderRadius: 14,
                  paddingVertical: 14, alignItems: \'center\',
                  opacity: pressed ? 0.8 : 1, flexDirection: \'row\', justifyContent: \'center\', gap: 6,
                })}
              >
                <IconSymbol name="checkmark" size={16} color="#FFF" />
                <Text style={{ color: \'#FFF\', fontSize: fs.md, fontWeight: \'700\' }}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => handleReject(selectedAppt)}
                style={({ pressed }) => ({
                  flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: \'#F44336\',
                  paddingVertical: 14, alignItems: \'center\',
                  opacity: pressed ? 0.8 : 1, flexDirection: \'row\', justifyContent: \'center\', gap: 6,
                })}
              >
                <IconSymbol name="xmark" size={16} color="#F44336" />
                <Text style={{ color: \'#F44336\', fontSize: fs.md, fontWeight: \'700\' }}>Reject</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

'''

# ── 6. Build the new split-view render structure ──────────────────────────
new_scroll_block = [
    '      {useSideBySide ? (\n',
    '        // ── Tablet landscape: two-column split view ──────────────────────────\n',
    '        <View style={{ flex: 1, flexDirection: \'row\' }}>\n',
    '          {/* Left column: filter + list (42%) */}\n',
    '          <ScrollView\n',
    '            ref={scrollRef}\n',
    '            showsVerticalScrollIndicator={false}\n',
    '            style={{ width: \'42%\', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}\n',
    '            contentContainerStyle={{ paddingBottom: 120 }}\n',
    '          >\n',
    '            {listContent}\n',
    '          </ScrollView>\n',
    '          {/* Right column: detail panel (58%) */}\n',
    '          <View style={{ flex: 1, backgroundColor: colors.background }}>\n',
    '            {renderDetailPanel()}\n',
    '          </View>\n',
    '        </View>\n',
    '      ) : (\n',
    '        <ScrollView\n',
    '          ref={scrollRef}\n',
    '          showsVerticalScrollIndicator={false}\n',
    '          contentContainerStyle={{ paddingBottom: 120, maxWidth: maxContentWidth, alignSelf: "center", width: "100%" }}\n',
    '        >\n',
    '          {listContent}\n',
    '        </ScrollView>\n',
    '      )}\n',
]

# ── 7. Find the return statement line to insert before it ─────────────────
return_line = None
for i, line in enumerate(lines):
    if line.strip() == 'return (' and i > 600:
        return_line = i
        print(f"Return statement at line {i+1}")
        break

# ── 8. Assemble the final file ────────────────────────────────────────────
# Parts:
# A. lines[0:return_line]  (everything before return)
# B. listContent variable
# C. renderDetailPanel function
# D. return statement line
# E. lines[return_line+1:scroll_start]  (ScreenContainer + FuturisticBackground)
# F. new_scroll_block  (replaces old ScrollView)
# G. lines[scroll_end+1:]  (Modals, ScreenContainer closing, etc.)

part_a = lines[:return_line]
part_b = list_content_lines
part_c = render_detail_fn.splitlines(keepends=True)
part_d = [lines[return_line]]  # "  return (\n"
part_e = lines[return_line+1:scroll_start]  # "    <ScreenContainer>\n", "      <FuturisticBackground />\n"
part_f = new_scroll_block
part_g = lines[scroll_end+1:]

new_lines = part_a + part_b + part_c + part_d + part_e + part_f + part_g

print(f"New file: {len(new_lines)} lines (was {total})")

with open('app/(tabs)/bookings.tsx', 'w') as f:
    f.writelines(new_lines)

print("Done!")
