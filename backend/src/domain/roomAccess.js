import { ApiError } from '../http/envelope.js';

export function isRoomParticipant(db, room, accountId) {
  if (!room || !accountId) return false;
  const peerAccountId = room.peerAccountId ?? db.findAccountByPeerId(room.peerUserId);
  return room.initiatorAccountId === accountId || peerAccountId === accountId;
}

export function requireRoomParticipant(db, room, accountId) {
  if (!isRoomParticipant(db, room, accountId)) throw new ApiError('forbidden', 'not a room participant');
  return room;
}
