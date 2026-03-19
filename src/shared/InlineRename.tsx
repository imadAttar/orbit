import { useState, useRef, useEffect } from "react";

export default function InlineRename({
  value,
  onConfirm,
  onCancel,
}: {
  value: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="inline-rename"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onConfirm(text.trim() || value);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onConfirm(text.trim() || value)}
      autoFocus
    />
  );
}
