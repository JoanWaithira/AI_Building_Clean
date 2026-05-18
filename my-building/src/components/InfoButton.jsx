import React from "react";

export default function InfoButton({ info }) {
  return (
    <span style={{ marginLeft: 6, cursor: "pointer", display: "inline-block" }} title={info}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: "middle" }}>
        <circle cx="8" cy="8" r="7" stroke="#888" strokeWidth="1.5" fill="#f8f8f8" />
        <text x="8" y="12" textAnchor="middle" fontSize="10" fill="#555" fontFamily="Arial" fontWeight="bold">i</text>
      </svg>
    </span>
  );
}
