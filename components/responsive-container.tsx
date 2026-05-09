/**
 * ResponsiveContainer — centers content on tablets with a max-width constraint.
 * Use this as the inner wrapper inside ScreenContainer for all screen content.
 *
 * Usage:
 * ```tsx
 * <ScreenContainer>
 *   <ResponsiveContainer>
 *     {content}
 *   </ResponsiveContainer>
 * </ScreenContainer>
 * ```
 */
import { View, type ViewProps } from "react-native";
import { useResponsive } from "@/hooks/use-responsive";

interface ResponsiveContainerProps extends ViewProps {
  /** Override the max width (defaults to maxContentWidth from useResponsive) */
  maxWidth?: number;
  /** Additional className */
  className?: string;
}

export function ResponsiveContainer({ children, maxWidth, style, ...props }: ResponsiveContainerProps) {
  const { maxContentWidth } = useResponsive();
  const mw = maxWidth ?? maxContentWidth;

  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth: mw,
          alignSelf: "center",
          flex: 1,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

/**
 * ModalSheetContainer — wraps modal/bottom-sheet content with a tablet-safe max-width.
 * Place this inside the inner View of any Modal or bottom sheet.
 *
 * Usage:
 * ```tsx
 * <Modal visible={...} transparent animationType="slide">
 *   <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
 *     <ModalSheetContainer>
 *       {sheetContent}
 *     </ModalSheetContainer>
 *   </View>
 * </Modal>
 * ```
 */
export function ModalSheetContainer({ children, style, ...props }: ViewProps) {
  const { modalMaxWidth } = useResponsive();

  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth: modalMaxWidth,
          alignSelf: "center",
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
