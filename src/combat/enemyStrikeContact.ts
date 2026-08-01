export interface Position3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function enemyStrikeConnects(
  glovePosition: Position3,
  playerPosition: Position3,
  contactRadius: number,
) {
  if (!Number.isFinite(contactRadius) || contactRadius <= 0) return false;
  const offsetX = glovePosition.x - playerPosition.x;
  const offsetY = glovePosition.y - playerPosition.y;
  const offsetZ = glovePosition.z - playerPosition.z;
  return (
    offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ <=
    contactRadius * contactRadius
  );
}
