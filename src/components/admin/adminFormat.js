export const naira = (value) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

export const when = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};
