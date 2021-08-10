import type { Provider } from 'oidc-provider';
import urljoin from 'url-join';
import type { ProviderFactory } from '../../../src/identity/configuration/ProviderFactory';
import { InteractionRoute, IdentityProviderHttpHandler } from '../../../src/identity/IdentityProviderHttpHandler';
import type { InteractionHandler } from '../../../src/identity/interaction/email-password/handler/InteractionHandler';
import { IdpInteractionError } from '../../../src/identity/interaction/util/IdpInteractionError';
import type { InteractionCompleter } from '../../../src/identity/interaction/util/InteractionCompleter';
import type { ErrorHandler } from '../../../src/ldp/http/ErrorHandler';
import type { RequestParser } from '../../../src/ldp/http/RequestParser';
import type { ResponseWriter } from '../../../src/ldp/http/ResponseWriter';
import type { Operation } from '../../../src/ldp/operations/Operation';
import { BasicRepresentation } from '../../../src/ldp/representation/BasicRepresentation';
import type { Representation } from '../../../src/ldp/representation/Representation';
import type { HttpRequest } from '../../../src/server/HttpRequest';
import type { HttpResponse } from '../../../src/server/HttpResponse';
import type {
  RepresentationConverter,
  RepresentationConverterArgs,
} from '../../../src/storage/conversion/RepresentationConverter';
import { BadRequestHttpError } from '../../../src/util/errors/BadRequestHttpError';
import { InternalServerError } from '../../../src/util/errors/InternalServerError';
import { readableToString } from '../../../src/util/StreamUtil';
import { SOLID_HTTP, SOLID_META } from '../../../src/util/Vocabularies';

describe('An IdentityProviderHttpHandler', (): void => {
  const apiVersion = '0.1';
  const baseUrl = 'http://test.com/';
  const idpPath = '/idp';
  let request: HttpRequest;
  const response: HttpResponse = {} as any;
  let requestParser: jest.Mocked<RequestParser>;
  let providerFactory: jest.Mocked<ProviderFactory>;
  let routes: { response: InteractionRoute; complete: InteractionRoute };
  let interactionCompleter: jest.Mocked<InteractionCompleter>;
  let converter: jest.Mocked<RepresentationConverter>;
  let errorHandler: jest.Mocked<ErrorHandler>;
  let responseWriter: jest.Mocked<ResponseWriter>;
  let provider: jest.Mocked<Provider>;
  let handler: IdentityProviderHttpHandler;

  beforeEach(async(): Promise<void> => {
    request = { url: '/idp', method: 'GET', headers: {}} as any;

    requestParser = {
      handleSafe: jest.fn(async(req: HttpRequest): Promise<Operation> => ({
        target: { path: urljoin(baseUrl, req.url!) },
        method: req.method!,
        body: new BasicRepresentation('', req.headers['content-type'] ?? 'text/plain'),
        preferences: { type: { 'text/html': 1 }},
      })),
    } as any;

    provider = {
      callback: jest.fn(),
      interactionDetails: jest.fn(),
    } as any;

    providerFactory = {
      getProvider: jest.fn().mockResolvedValue(provider),
    };

    const handlers: InteractionHandler[] = [
      { handleSafe: jest.fn().mockResolvedValue({ type: 'response', details: { key: 'val' }}) } as any,
      { handleSafe: jest.fn().mockResolvedValue({ type: 'complete', details: { webId: 'webId' }}) } as any,
    ];

    routes = {
      response: new InteractionRoute('/routeResponse',
        { 'text/html': '/view1' },
        handlers[0],
        'default',
        { 'text/html': '/response1' }),
      complete: new InteractionRoute('/routeComplete',
        { 'text/html': '/view2' },
        handlers[1],
        'other'),
    };

    converter = {
      handleSafe: jest.fn((input: RepresentationConverterArgs): Representation => input.representation),
    } as any;

    interactionCompleter = { handleSafe: jest.fn().mockResolvedValue('http://test.com/idp/auth') } as any;

    errorHandler = { handleSafe: jest.fn() } as any;

    responseWriter = { handleSafe: jest.fn() } as any;

    handler = new IdentityProviderHttpHandler(
      baseUrl,
      idpPath,
      requestParser,
      providerFactory,
      Object.values(routes),
      converter,
      interactionCompleter,
      errorHandler,
      responseWriter,
    );
  });

  it('calls the provider if there is no matching route.', async(): Promise<void> => {
    request.url = 'invalid';
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    expect(provider.callback).toHaveBeenCalledTimes(1);
    expect(provider.callback).toHaveBeenLastCalledWith(request, response);
  });

  it('creates default Representations for GET requests.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();

    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const { response: mockResponse, result } = responseWriter.handleSafe.mock.calls[0][0];
    expect(mockResponse).toBe(response);
    expect(JSON.parse(await readableToString(result.data!))).toEqual({ apiVersion, errorMessage: '', prefilled: {}});
    expect(result.statusCode).toBe(200);
    expect(result.metadata?.contentType).toBe('application/json');
    expect(result.metadata?.get(SOLID_META.template)?.value).toBe(routes.response.viewTemplates['text/html']);
  });

  it('creates Representations for InteractionResponseResults.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'POST';
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    const operation = await requestParser.handleSafe.mock.results[0].value;
    expect(routes.response.handler.handleSafe).toHaveBeenCalledTimes(1);
    expect(routes.response.handler.handleSafe).toHaveBeenLastCalledWith({ operation });

    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const { response: mockResponse, result } = responseWriter.handleSafe.mock.calls[0][0];
    expect(mockResponse).toBe(response);
    expect(JSON.parse(await readableToString(result.data!))).toEqual({ apiVersion, key: 'val' });
    expect(result.statusCode).toBe(200);
    expect(result.metadata?.contentType).toBe('application/json');
    expect(result.metadata?.get(SOLID_META.template)?.value).toBe(routes.response.responseTemplates['text/html']);
  });

  it('supports InteractionResponseResults without details.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'POST';
    (routes.response.handler as jest.Mocked<InteractionHandler>).handleSafe.mockResolvedValueOnce({ type: 'response' });
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();

    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const { result } = responseWriter.handleSafe.mock.calls[0][0];
    expect(JSON.parse(await readableToString(result.data!))).toEqual({ apiVersion });
  });

  it('calls the interactionCompleter for InteractionCompleteResults and redirects.', async(): Promise<void> => {
    request.url = '/idp/routeComplete';
    request.method = 'POST';
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    const operation = await requestParser.handleSafe.mock.results[0].value;
    expect(routes.complete.handler.handleSafe).toHaveBeenCalledTimes(1);
    expect(routes.complete.handler.handleSafe).toHaveBeenLastCalledWith({ operation });
    expect(interactionCompleter.handleSafe).toHaveBeenCalledTimes(1);
    expect(interactionCompleter.handleSafe).toHaveBeenLastCalledWith({ request, webId: 'webId' });
    const location = await interactionCompleter.handleSafe.mock.results[0].value;
    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const args = responseWriter.handleSafe.mock.calls[0][0];
    expect(args.response).toBe(response);
    expect(args.result.statusCode).toBe(302);
    expect(args.result.metadata?.get(SOLID_HTTP.terms.location)?.value).toBe(location);
  });

  it('matches paths based on prompt for requests to the root IDP.', async(): Promise<void> => {
    request.url = '/idp';
    request.method = 'POST';
    const oidcInteraction = { prompt: { name: 'other' }};
    provider.interactionDetails.mockResolvedValueOnce(oidcInteraction as any);
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    const operation = await requestParser.handleSafe.mock.results[0].value;
    expect(routes.response.handler.handleSafe).toHaveBeenCalledTimes(0);
    expect(routes.complete.handler.handleSafe).toHaveBeenCalledTimes(1);
    expect(routes.complete.handler.handleSafe).toHaveBeenLastCalledWith({ operation, oidcInteraction });
  });

  it('uses the default route for requests to the root IDP without (matching) prompt.', async(): Promise<void> => {
    request.url = '/idp';
    request.method = 'POST';
    const oidcInteraction = { prompt: { name: 'notSupported' }};
    provider.interactionDetails.mockResolvedValueOnce(oidcInteraction as any);
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    const operation = await requestParser.handleSafe.mock.results[0].value;
    expect(routes.response.handler.handleSafe).toHaveBeenCalledTimes(1);
    expect(routes.response.handler.handleSafe).toHaveBeenLastCalledWith({ operation, oidcInteraction });
    expect(routes.complete.handler.handleSafe).toHaveBeenCalledTimes(0);
  });

  it('displays a viewTemplate again in case of POST errors.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'POST';
    (routes.response.handler.handleSafe as any)
      .mockRejectedValueOnce(new IdpInteractionError(500, 'handle error', { name: 'name' }));
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();

    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const { response: mockResponse, result } = responseWriter.handleSafe.mock.calls[0][0];
    expect(mockResponse).toBe(response);
    expect(JSON.parse(await readableToString(result.data!)))
      .toEqual({ apiVersion, errorMessage: 'handle error', prefilled: { name: 'name' }});
    expect(result.statusCode).toBe(200);
    expect(result.metadata?.contentType).toBe('application/json');
    expect(result.metadata?.get(SOLID_META.template)?.value).toBe(routes.response.viewTemplates['text/html']);
  });

  it('defaults to an empty prefilled object in case of POST errors.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'POST';
    (routes.response.handler.handleSafe as any).mockRejectedValueOnce(new Error('handle error'));
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();

    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    const { response: mockResponse, result } = responseWriter.handleSafe.mock.calls[0][0];
    expect(mockResponse).toBe(response);
    expect(JSON.parse(await readableToString(result.data!)))
      .toEqual({ apiVersion, errorMessage: 'handle error', prefilled: {}});
  });

  it('calls the errorHandler if there is a problem resolving the request.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'GET';
    const error = new Error('bad template');
    converter.handleSafe.mockRejectedValueOnce(error);
    errorHandler.handleSafe.mockResolvedValueOnce({ statusCode: 500 });
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    expect(errorHandler.handleSafe).toHaveBeenCalledTimes(1);
    expect(errorHandler.handleSafe).toHaveBeenLastCalledWith({ error, preferences: { type: { 'text/html': 1 }}});
    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    expect(responseWriter.handleSafe).toHaveBeenLastCalledWith({ response, result: { statusCode: 500 }});
  });

  it('can only resolve GET/POST requests.', async(): Promise<void> => {
    request.url = '/idp/routeResponse';
    request.method = 'DELETE';
    const error = new BadRequestHttpError('Unsupported request: DELETE http://test.com/idp/routeResponse');
    errorHandler.handleSafe.mockResolvedValueOnce({ statusCode: 500 });
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    expect(errorHandler.handleSafe).toHaveBeenCalledTimes(1);
    expect(errorHandler.handleSafe).toHaveBeenLastCalledWith({ error, preferences: { type: { 'text/html': 1 }}});
    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    expect(responseWriter.handleSafe).toHaveBeenLastCalledWith({ response, result: { statusCode: 500 }});
  });

  it('errors if no route is configured for the default prompt.', async(): Promise<void> => {
    handler = new IdentityProviderHttpHandler(
      baseUrl,
      idpPath,
      requestParser,
      providerFactory,
      [],
      converter,
      interactionCompleter,
      errorHandler,
      responseWriter,
    );
    request.url = '/idp';
    provider.interactionDetails.mockResolvedValueOnce({ prompt: { name: 'other' }} as any);
    const error = new InternalServerError('No handler for the default session prompt has been configured.');
    errorHandler.handleSafe.mockResolvedValueOnce({ statusCode: 500 });
    await expect(handler.handle({ request, response })).resolves.toBeUndefined();
    expect(errorHandler.handleSafe).toHaveBeenCalledTimes(1);
    expect(errorHandler.handleSafe).toHaveBeenLastCalledWith({ error, preferences: { type: { 'text/html': 1 }}});
    expect(responseWriter.handleSafe).toHaveBeenCalledTimes(1);
    expect(responseWriter.handleSafe).toHaveBeenLastCalledWith({ response, result: { statusCode: 500 }});
  });
});
