import { useEffect, useState, type FC } from "react";

import { Button } from "@/components/ui/button";
import { formatAccelerator, isApplePlatform } from "@/lib/accelerator";
import { setHotkeyCapture } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export interface HotkeyRecorderProps {
  hotkey: string;
  onHotkeyChange: (accelerator: string) => void;
  /** Lets the surrounding row explain how to get out while recording. */
  onRecordingChange?: (isRecording: boolean) => void;
}

/** Keys that only ever modify another key — a shortcut of just these would fire constantly. */
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

/**
 * Builds a Tauri accelerator from a keydown.
 *
 * Returns null while only modifiers are held, which is the normal state mid-chord: the user has
 * pressed Cmd and Shift and has not yet chosen the key. Recording that would capture "⌘ + ⇧" as a
 * complete shortcut the instant they reached for it.
 */
const toAccelerator = (event: KeyboardEvent): string | null => {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  const parts: string[] = [];

  // CmdOrCtrl rather than the literal key, so a shortcut recorded on a Mac still means the right
  // thing on Windows and Linux.
  if (event.metaKey || event.ctrlKey) {
    parts.push("CmdOrCtrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

  parts.push(key);

  // A bare letter would fire while typing anywhere in the OS, so at least one modifier is
  // required. Function keys are exempt: they are not typed into anything.
  const isFunctionKey = /^F\d{1,2}$/.test(key);

  if (parts.length === 1 && !isFunctionKey) {
    return null;
  }

  return parts.join("+");
};

/**
 * Captures a shortcut by listening for the next keypress.
 *
 * A text field would be wrong here: the user is not typing a string, they are demonstrating a
 * chord, and the two produce different results for the same keystrokes.
 */
export const HotkeyRecorder: FC<HotkeyRecorderProps> = ({
  hotkey,
  onHotkeyChange,
  onRecordingChange,
}) => {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  /**
   * Listens on the window rather than the button.
   *
   * macOS WebKit does not give a `<button>` keyboard focus when it is clicked, so a `keydown`
   * handler on the element never fires and nothing can be recorded — not the chord, not even
   * Escape. Capturing at the window sidesteps focus entirely, which is what a shortcut recorder
   * wants anyway: the user is demonstrating a chord to the app, not typing into a control.
   */
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    // The OS holds the current shortcut. Left registered, pressing it here toggles the panel
    // away instead of being recorded — you could never rebind a shortcut by pressing it.
    void setHotkeyCapture(true);

    const handleKeyDown = (event: KeyboardEvent): void => {
      // Capture phase plus stopPropagation so nothing else in the panel reacts to keys that are
      // meant for the recorder.
      event.preventDefault();
      event.stopPropagation();

      // Escape abandons the recording. Without it Escape would be captured as a shortcut and
      // there would be no way out — but it is invisible, hence the cancel button too.
      if (event.key === "Escape") {
        setIsRecording(false);
        return;
      }

      const accelerator = toAccelerator(event);

      if (accelerator === null) {
        return;
      }

      onHotkeyChange(accelerator);
      setIsRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      // Restored on every exit — recorded, cancelled, or unmounted. Missing one path would
      // leave the app with no working shortcut until the next launch.
      void setHotkeyCapture(false);
    };
  }, [isRecording, onHotkeyChange]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={
        isRecording
          ? "Press the new shortcut, or Escape to cancel"
          : "Change the panel shortcut"
      }
      onClick={() => {
        setIsRecording(true);
      }}
      className={cn(
        "text-numeric card-raised border-border min-w-[7.5rem] shrink-0 justify-center border",
        isRecording && "ring-ring ring-2",
      )}
    >
      {isRecording
        ? "Press keys…"
        : formatAccelerator(hotkey, isApplePlatform())}
    </Button>
  );
};
