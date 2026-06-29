import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

const BASE_INPUT_CLASSES =
  "w-full font-sans text-[13px] text-[#2A3550] outline-none placeholder:text-muted-2 disabled:cursor-not-allowed disabled:opacity-60 focus:border-[#C7D2E6]";

const INPUT_PADDING = "rounded-[10px] px-[14px] py-3";
const TEXTAREA_PADDING = "rounded-xl px-[15px] py-[14px] leading-[1.6] resize-y";

/**
 * Text input. Wraps the native `<input>` with the project's surface styles.
 * Pass `className` to override (e.g. shorter padding, no full width).
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, style, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={[BASE_INPUT_CLASSES, INPUT_PADDING, className ?? ""].filter(Boolean).join(" ")}
        style={{ border: "1px solid #C9D4E8", background: "#FBFCFE", ...style }}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, style, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={[BASE_INPUT_CLASSES, TEXTAREA_PADDING, className ?? ""].filter(Boolean).join(" ")}
      style={{ border: "1px solid #C9D4E8", background: "#FBFCFE", ...style }}
      {...rest}
    />
  );
});
