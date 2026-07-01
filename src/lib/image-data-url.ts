import { GatewayError } from '../http/error-response.js';

export interface ParseImageDataUrlOptions {
  /** Restrict the accepted mime type; when omitted any non-empty mime is allowed. */
  allowedMimePattern?: RegExp;
  /** Lower-case the parsed mime type before validating and returning it. */
  lowercaseMimeType?: boolean;
}

export const parseImageDataUrl = (
  value: string,
  invalidMessage: string,
  options: ParseImageDataUrlOptions = {},
): { mimeType: string; data: string } => {
  if (value.substring(0, 5).toLowerCase() !== 'data:') {
    throw new GatewayError(400, 'VALIDATION_FAILED', invalidMessage);
  }

  const suffixIdx = value.toLowerCase().indexOf(';base64,', 5);
  if (suffixIdx === -1) {
    throw new GatewayError(400, 'VALIDATION_FAILED', invalidMessage);
  }

  const rawMimeType = value.substring(5, suffixIdx);
  const mimeType = options.lowercaseMimeType ? rawMimeType.toLowerCase() : rawMimeType;
  const data = value.substring(suffixIdx + 8).replace(/\s+/g, '');

  const mimeIsValid = options.allowedMimePattern
    ? options.allowedMimePattern.test(mimeType)
    : mimeType.length > 0;
  if (!mimeIsValid) {
    throw new GatewayError(400, 'VALIDATION_FAILED', invalidMessage);
  }

  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    // [A-Za-z0-9+/=]
    if (
      !(code >= 65 && code <= 90) && // A-Z
      !(code >= 97 && code <= 122) && // a-z
      !(code >= 48 && code <= 57) && // 0-9
      code !== 43 && // +
      code !== 47 && // /
      code !== 61 // =
    ) {
      throw new GatewayError(400, 'VALIDATION_FAILED', invalidMessage);
    }
  }

  return {
    mimeType,
    data,
  };
};
