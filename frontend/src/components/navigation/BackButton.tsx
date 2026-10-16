"use client";

import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  fallbackHref?: string;
  label?: string;
}

export default function BackButton({ fallbackHref = "/", label = "Back / Previous" }: BackButtonProps) {
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = fallbackHref;
  };

  return (
    <button type="button" className="btn" onClick={goBack} title="Return to previous page">
      <ArrowLeft size={16} /> {label}
    </button>
  );
}
