/**
 * ModalSheet — a bottom-sheet style Modal wrapper that:
 * - Centers and constrains content width on tablets (max 560dp)
 * - Handles KeyboardAvoidingView automatically
 * - Applies standard backdrop overlay
 * - Provides consistent border radius and background
 *
 * Usage:
 * ```tsx
 * <ModalSheet
 *   visible={showModal}
 *   onClose={() => setShowModal(false)}
 *   title="Sheet Title"
 * >
 *   {content}
 * </ModalSheet>
 * ```
 */
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** If true, wraps children in a ScrollView */
  scrollable?: boolean;
  /** Override inner content padding (default: 20) */
  padding?: number;
  /** Override bottom padding (default: 40) */
  paddingBottom?: number;
  /** Override max height as fraction of screen height (default: 0.92 phone, 0.8 tablet) */
  maxHeightFraction?: number;
  children: React.ReactNode;
  /** Additional style for the inner sheet container */
  sheetStyle?: ViewStyle;
  /** If true, tapping the backdrop does NOT close the sheet */
  disableBackdropClose?: boolean;
  /** animationType for the Modal (default: "slide") */
  animationType?: "slide" | "fade" | "none";
}

export function ModalSheet({
  visible,
  onClose,
  title,
  scrollable = false,
  padding = 20,
  paddingBottom = 40,
  maxHeightFraction,
  children,
  sheetStyle,
  disableBackdropClose = false,
  animationType = "slide",
}: ModalSheetProps) {
  const colors = useColors();
  const { modalMaxWidth, sheetMaxHeight, sheetRadius, height } = useResponsive();

  const maxH = (maxHeightFraction ?? sheetMaxHeight) * height;

  const sheetContent = (
    <View
      style={[
        {
          backgroundColor: colors.background,
          borderTopLeftRadius: sheetRadius,
          borderTopRightRadius: sheetRadius,
          padding,
          paddingBottom,
          maxHeight: maxH,
          width: "100%",
          maxWidth: modalMaxWidth,
          alignSelf: "center",
        },
        sheetStyle,
      ]}
    >
      {/* Handle bar */}
      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          alignSelf: "center",
          marginBottom: title ? 12 : 8,
        }}
      />

      {/* Header row */}
      {title && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: colors.foreground,
              flex: 1,
            }}
          >
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4 }]}
            hitSlop={8}
          >
            <IconSymbol name="xmark" size={22} color={colors.muted} />
          </Pressable>
        </View>
      )}

      {scrollable ? (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
          onPress={disableBackdropClose ? undefined : onClose}
        />
        {sheetContent}
      </KeyboardAvoidingView>
    </Modal>
  );
}
