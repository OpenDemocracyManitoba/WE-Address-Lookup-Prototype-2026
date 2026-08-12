export function calculatePopupGeometry({
  inputTop,
  inputBottom,
  viewportTop,
  viewportHeight,
}) {
  const viewportBottom = viewportTop + viewportHeight;
  const margin = 10;
  const below = Math.max(0, viewportBottom - inputBottom - margin);
  const above = Math.max(0, inputTop - viewportTop - margin);
  const preferredMinimum = Math.min(240, viewportHeight * 0.42);
  const hasPreferredRoomBelow = below >= preferredMinimum;
  const belowHasAtLeastAsMuchRoom = below >= above;
  const opensBelow = hasPreferredRoomBelow || belowHasAtLeastAsMuchRoom;
  const side = opensBelow ? "below" : "above";
  const available = side === "below" ? below : above;
  const maxHeight = Math.max(48, Math.floor(available - 6));

  return { side, maxHeight };
}
