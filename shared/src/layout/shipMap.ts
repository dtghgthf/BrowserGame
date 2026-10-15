/**
 * The ship, as an ASCII tile map (one character = one 0.5 m tile = 8 px of art).
 * Bow is on the right. Edit this map to change the ship; collision, light occluders,
 * ladders, hatches, water compartments and markers are all derived from it.
 * The hull art (client/public/assets/ship_*.png) must match these dimensions.
 *
 * Legend
 *   ' '  exterior air (outside the hull)        '.'  interior air
 *   '#'  solid (hull, deck, wall)               'H'  ladder
 *   '|'  railing: solid for physics, but does not block light
 *   '='  hatch in a floor (with ladder below = one-way platform when open)
 *   'x'  solid hull tile with a possible leak    '@'  player spawn
 *   'w'  steering wheel   'p'  pump   's'  searchlight   'c'  cannon   'k'  workshop
 *   'l'  lantern (hangs from the ceiling above)  'b'  crate   'f'  barrel (oil)   'n'  plank
 *   'u'  rack of cannon balls   'o'  oil can   'e'  bucket   'r'  life ring (station)   't'  chart table
 */
export const SHIP_MAP: readonly string[] = [
  '                                                                        ',
  '                                                                        ',
  '                                                                        ',
  '                               |    s|                                  ',
  '                               |||=|||                                  ',
  '                                  H                                     ',
  '                                  H                                     ',
  '                                  H                                     ',
  '                                  H                                     ',
  '                                  H                                     ',
  '   #                              H                                 #   ',
  '   #                              H                                 #   ',
  '   # r  w        @  @  @  @       H                         u  c    ##  ',
  '   ###########=#########################################=#############  ',
  '   #.....l....H.........#..........l..........#.........H...l.......#   ',
  '   #..........H.........#.....................#.........H...........#   ',
  '   #..........H.........................................H..........##   ',
  '   #..........H.........................................H..........x    ',
  '   ##..e......H....t........b....o......k..n............H.........##    ',
  '    ##########################=###################==###############     ',
  '    ##..............l.........H.....#...........l................##     ',
  '     #........................H.................................##      ',
  '     #x.......................H................................x#       ',
  '      ##......................H..............................x##        ',
  '       ###....p...............H.........b.b.........f.f....###          ',
  '         ###################################x###############            ',
  '            #############################################               ',
];

/** Pivot of the ship (rotation centre, rest waterline) in tile coordinates. */
export const SHIP_ORIGIN = { x: 36, y: 19.5 } as const;

/** Names for water compartments, identified by one tile they contain. */
export const COMPARTMENT_NAMES: readonly { name: string; tx: number; ty: number }[] = [
  { name: 'Mitteldeck', tx: 10, ty: 16 },
  { name: 'Unterdeck', tx: 20, ty: 23 },
];
