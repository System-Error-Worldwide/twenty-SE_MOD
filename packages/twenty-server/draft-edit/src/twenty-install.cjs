const { z } = require('zod');
const PostalMime = require('postal-mime');
const MailComposer = require('nodemailer/lib/mail-composer');
const { EmailOperation } = require('twenty-shared/types');
const { convertEmailBodyToEmailDocument } = require('twenty-shared/utils');
const { compileOutboundEmailContent } = require('../../dist/engine/core-modules/email/utils/compile-outbound-email-content.util.js');
const { PermissionFlagType } = require('twenty-shared/constants');
const { getStandardFolderByRegex } = require('../../dist/modules/messaging/message-import-manager/drivers/utils/get-standard-folder-by-regex.js');
const { StandardFolder } = require('../../dist/modules/messaging/message-import-manager/drivers/types/standard-folder.type.js');

exports.register = async (provider) => {
  try {
    const { installTwentyDraftEditing } = await import('./twenty-bootstrap.mjs');
    await installTwentyDraftEditing({ provider, z, PostalMime, MailComposer, EmailOperation, PermissionFlagType, getStandardFolderByRegex, StandardFolder, convertEmailBodyToEmailDocument, compileOutboundEmailContent });
    return { ready: true };
  } catch {
    console.warn('Draft editing is unavailable; existing tools remain active.');
    return { ready: false };
  }
};
