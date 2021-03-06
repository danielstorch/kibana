/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { i18n } from '@kbn/i18n';
import { KibanaContext, TimeRange, Filter, esQuery, Query } from '../../../data/public';
import { TimelionVisDependencies } from '../plugin';
import { getTimezone } from './get_timezone';
import { TimelionVisParams } from '../timelion_vis_fn';
import { getDataSearch } from '../helpers/plugin_services';

interface Stats {
  cacheCount: number;
  invokeTime: number;
  queryCount: number;
  queryTime: number;
  sheetTime: number;
}

export interface Series {
  _global?: boolean;
  _hide?: boolean;
  _id?: number;
  _title?: string;
  color?: string;
  data: Array<Record<number, number>>;
  fit: string;
  label: string;
  split: string;
  stack?: boolean;
  type: string;
}

export interface Sheet {
  list: Series[];
  render?: {
    grid?: boolean;
  };
  type: string;
}

export interface TimelionSuccessResponse {
  sheet: Sheet[];
  stats: Stats;
  visType: string;
  type: KibanaContext['type'];
}

export function getTimelionRequestHandler({
  uiSettings,
  http,
  timefilter,
}: TimelionVisDependencies) {
  const timezone = getTimezone(uiSettings);

  return async function ({
    timeRange,
    filters,
    query,
    visParams,
    searchSessionId,
  }: {
    timeRange: TimeRange;
    filters: Filter[];
    query: Query;
    visParams: TimelionVisParams;
    searchSessionId?: string;
  }): Promise<TimelionSuccessResponse> {
    const dataSearch = getDataSearch();
    const expression = visParams.expression;

    if (!expression) {
      throw new Error(
        i18n.translate('timelion.emptyExpressionErrorMessage', {
          defaultMessage: 'Timelion error: No expression provided',
        })
      );
    }

    const esQueryConfigs = esQuery.getEsQueryConfig(uiSettings);

    // parse the time range client side to make sure it behaves like other charts
    const timeRangeBounds = timefilter.calculateBounds(timeRange);
    const untrackSearch =
      dataSearch.session.isCurrentSession(searchSessionId) &&
      dataSearch.session.trackSearch({
        abort: () => {
          // TODO: support search cancellations
        },
      });

    try {
      return await http.post('/api/timelion/run', {
        body: JSON.stringify({
          sheet: [expression],
          extended: {
            es: {
              filter: esQuery.buildEsQuery(undefined, query, filters, esQueryConfigs),
            },
          },
          time: {
            from: timeRangeBounds.min,
            to: timeRangeBounds.max,
            interval: visParams.interval,
            timezone,
          },
          ...(searchSessionId && {
            searchSession: dataSearch.session.getSearchOptions(searchSessionId),
          }),
        }),
      });
    } catch (e) {
      if (e && e.body) {
        const err = new Error(
          `${i18n.translate('timelion.requestHandlerErrorTitle', {
            defaultMessage: 'Timelion request error',
          })}: ${e.body.title} ${e.body.message}`
        );
        err.stack = e.stack;
        throw err;
      } else {
        throw e;
      }
    } finally {
      if (untrackSearch && dataSearch.session.isCurrentSession(searchSessionId)) {
        // call `untrack` if this search still belongs to current session
        untrackSearch();
      }
    }
  };
}
