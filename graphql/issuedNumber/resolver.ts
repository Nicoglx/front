import { ApolloError } from 'apollo-server-core';
import getConfig from 'next/config';
import compareAsc from 'date-fns/compareAsc';
import startOfDay from 'date-fns/startOfDay';
import * as Sentry from '@sentry/node';

import {
  MutationRequestTurnArgs,
  MutationCancelTurnArgs,
  QueryTurnArgs,
} from '../../graphql.d';
import { decodeId, encodeId } from 'src/utils/hashids';
import { myTurns, ISSUED_NUMBER_STATUS, myPastTurns } from './helpers';
import { numberToTurn } from 'graphql/utils/turn';
import { Context } from 'graphql/context';

const { publicRuntimeConfig } = getConfig();
const getTurns = (clientId: number, ctx: Context) => {
  return ctx.prisma.issuedNumber.findMany({
    where: {
      clientId: clientId,
      status: { in: [0, 1, 2] },
    },
    orderBy: {
      id: 'desc',
    },
    first: 5,
  });
};

const IssuedNumberResolver = {
  Query: {
    myPastTurns: async (parent, args: any, ctx: Context) => {
      if (!ctx.tokenInfo?.isValid) {
        return new ApolloError('Invalid token', 'INVALID_TOKEN');
      }

      return myPastTurns(ctx.tokenInfo.clientId, ctx.prisma);
    },
    myTurns: async (parent, args: any, ctx: Context) => {
      if (!ctx.tokenInfo?.isValid) {
        return new ApolloError('Invalid token', 'INVALID_TOKEN');
      }

      return myTurns(ctx.tokenInfo.clientId, ctx.prisma);
    },
    turn: async (parent, args: QueryTurnArgs, ctx: Context) => {
      if (!ctx.tokenInfo?.isValid) {
        return new ApolloError('Invalid token', 'INVALID_TOKEN');
      }

      const turnId = decodeId(args.turnId);

      if (!turnId) {
        return new ApolloError('Invalid turn id', 'INVALID_TURN_ID');
      }

      const issuedNumber = await ctx.prisma.issuedNumber.findOne({
        where: { id: turnId as number },
        select: {
          issuedNumber: true,
          clientId: true,
          status: true,
          shopDetails: { select: { name: true } },
        },
      });

      if (!issuedNumber || issuedNumber.clientId !== ctx.tokenInfo.clientId) {
        return new ApolloError('Turn not found', 'TURN_NOT_FOUND');
      }

      return {
        id: args.turnId,
        shopName: issuedNumber.shopDetails.name,
        turn: numberToTurn(issuedNumber.issuedNumber),
        status: issuedNumber.status,
      };
    },
  },
  Mutation: {
    requestTurn: async (
      parent,
      args: MutationRequestTurnArgs,
      ctx: Context
    ) => {
      if (!ctx.tokenInfo?.clientId) {
        return new ApolloError('Client Id not provided', 'INVALID_CLIENT_ID');
      }
      const shopId = decodeId(args.shopId) as number;

      if (!shopId) {
        return new ApolloError('Invalid shop id', 'INVALID_SHOP_ID');
      }

      let turns = await getTurns(ctx.tokenInfo.clientId, ctx);

      // limit to 1 pending turn per shopId
      const pendingTurnForShop = turns.find(
        (a) => a.shopId === shopId && a.status === 0
      );
      if (pendingTurnForShop) {
        return new ApolloError(
          'There is already a pending turn',
          'ACTIVE_TURN',
          { turnId: encodeId(pendingTurnForShop.id) }
        );
      }

      // Prevent more than 3 active turns.
      const pendingTurns = turns.filter((a) => a.status === 0);
      if (pendingTurns.length >= 3) {
        return new ApolloError(
          'Pending turns quota exceeded.',
          'PENDING_TURNS_QUOTA_EXCEEDED'
        );
      }

      // Prevent more than 5 turns per day
      const todayAppointments = turns.filter(
        (a) => compareAsc(a.createdAt, startOfDay(new Date())) >= 0
      );
      if (todayAppointments.length >= 5) {
        return new ApolloError(
          'Today turns quota exceeded',
          'TODAY_TURNS_QUOTA_EXCEEDED'
        );
      }

      const rawQuery = `CALL increaseShopCounter(
        ${shopId}, 
        ${ctx.tokenInfo.clientId},
        ${Number(publicRuntimeConfig.goToShopThreshold)}
      );`;

      try {
        await ctx.prisma.raw(rawQuery);
        //const newTurns = await getTurns(ctx.tokenInfo.clientId, ctx);
        return {
          //id: encodeId(newTurns[0].id), // TODO: Wait for Prisma to support returning results from raw queries and get the inserted ID from there
          pendingTurnsAmount: turns.length + 1,
        };
      } catch (error) {
        Sentry.captureException(error);
        return new ApolloError(
          'There was an error trying to set the appointment.',
          'OP_ERROR'
        );
      }
    },
    cancelTurn: async (parent, args: MutationCancelTurnArgs, ctx: Context) => {
      if (!ctx.tokenInfo?.isValid) {
        return new ApolloError('Invalid token', 'INVALID_TOKEN');
      }

      if (!ctx.tokenInfo?.clientId) {
        return new ApolloError('No client id', 'NO_CLIENT_ID');
      }

      const id = decodeId(args.turnId);

      if (!id) {
        return new ApolloError('Invalid id', 'INVALID_TURN_ID');
      }

      const issuedNumber = await ctx.prisma.issuedNumber.findOne({
        where: { id: id as number },
        select: { clientId: true },
      });

      if (!issuedNumber) {
        return new ApolloError('Turn not found', 'TURN_NOT_FOUND');
      }

      if (issuedNumber.clientId !== ctx.tokenInfo.clientId) {
        return new ApolloError('Invalid client', 'INVALID_CLIENT_ID');
      }

      await ctx.prisma.issuedNumber.update({
        where: {
          id: id as number,
        },
        data: {
          status: 3,
        },
        select: { id: true },
      });

      return true;
    },
  },
  IssuedNumber: {},
  IssuedNumberStatus: ISSUED_NUMBER_STATUS,
};

export default IssuedNumberResolver;
