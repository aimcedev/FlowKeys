export function applyEasing(t, curve) {
  switch (curve) {
    case 'linear':      return t;
    case 'ease-in':     return t * t;
    case 'ease-in-3':   return t * t * t;
    case 'ease-in-4':   return t * t * t * t;
    case 'ease-in-5':   return t * t * t * t * t;
    case 'log':         return Math.log(1 + t * (Math.E - 1));
    case 'ease-out':    return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out': return t < 0.5 ? 2*t*t : -1 + (4 - 2*t) * t;
    default:            return t * t;
  }
}
