// Package rooms implements ephemeral watch-together rooms.
//
// No user data is persisted: rooms live in memory only and vanish on
// restart (empty rooms are reaped after 30 minutes). Identity is a
// self-claimed username kept in the visitor's localStorage; the room
// creator additionally holds a masterKey (also localStorage) to reclaim
// mastership across reconnects. There is no JWT here.
package rooms
