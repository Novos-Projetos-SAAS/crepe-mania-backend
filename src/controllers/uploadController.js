import { imageStorageService } from '../services/imageStorageService.js';
import { requestAuditContext, success } from './helpers.js';

export const uploadController = {
  async product(req, res) {
    return success(res, await imageStorageService.upload('produtos', req.file, requestAuditContext(req)), 201);
  },
  async logo(req, res) {
    return success(res, await imageStorageService.upload('logo', req.file, requestAuditContext(req)), 201);
  },
};
