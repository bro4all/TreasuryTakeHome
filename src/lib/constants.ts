/** Stakeholder performance target: results back in about five seconds. */
export const PERFORMANCE_TARGET_MS = 5000;

/** Reject uploads above this size; phone photos are far smaller in practice. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** OCR workers kept warm; batch lanes match this so no lane queues on a worker. */
export const OCR_POOL_SIZE = 2;
