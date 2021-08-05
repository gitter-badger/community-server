import type { Interaction } from '../../../../src/identity/interaction/email-password/handler/InteractionHandler';
import { SessionHttpHandler } from '../../../../src/identity/interaction/SessionHttpHandler';
import type { Operation } from '../../../../src/ldp/operations/Operation';
import { NotImplementedHttpError } from '../../../../src/util/errors/NotImplementedHttpError';

describe('A SessionHttpHandler', (): void => {
  const operation: Operation = {} as any;
  const webId = 'http://test.com/id#me';
  let oidcInteraction: Interaction;
  let handler: SessionHttpHandler;

  beforeEach(async(): Promise<void> => {
    oidcInteraction = { session: { accountId: webId }} as any;

    handler = new SessionHttpHandler();
  });

  it('requires a defined oidcInteraction with a session.', async(): Promise<void> => {
    oidcInteraction!.session = undefined;
    await expect(handler.handle({ operation, oidcInteraction })).rejects.toThrow(NotImplementedHttpError);

    await expect(handler.handle({ operation })).rejects.toThrow(NotImplementedHttpError);
  });

  it('returns an InteractionCompleteResult when done.', async(): Promise<void> => {
    await expect(handler.handle({ operation, oidcInteraction })).resolves.toEqual({
      details: { webId },
      type: 'complete',
    });
  });
});
