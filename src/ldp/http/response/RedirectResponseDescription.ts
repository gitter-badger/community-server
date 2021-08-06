import { DataFactory } from 'n3';
import { SOLID_HTTP } from '../../../util/Vocabularies';
import { RepresentationMetadata } from '../../representation/RepresentationMetadata';
import { ResponseDescription } from './ResponseDescription';

/**
 * Corresponds to a 302 response, containing the relevant location metadata.
 */
export class RedirectResponseDescription extends ResponseDescription {
  public constructor(location: string) {
    const metadata = new RepresentationMetadata({ [SOLID_HTTP.location]: DataFactory.namedNode(location) });
    super(302, metadata);
  }
}
