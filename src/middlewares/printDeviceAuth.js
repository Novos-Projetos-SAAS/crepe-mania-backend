import { androidPrintingService } from '../services/androidPrintingService.js';

export async function requirePrintDevice(req, _res, next) {
  try {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    req.printDevice = await androidPrintingService.authenticate(token);
    next();
  } catch (error) {
    next(error);
  }
}
