export type Member={id:string;name:string;color:string;revision:number};
export type Offer={id:string;wantId:string;offerer:Member;qty:number;unitPriceHkd:string;status:"open"|"accepted"|"withdrawn";editable:boolean;createdAt:string;updatedAt:string};
export type Want={id:string;scryfallId:string;cardName:string;imageUrl:string|null;setCode:string;collectorNo:string;rarity:string;colors:string[];qty:number;offers:Offer[];acceptedOfferId:string|null;coveredQty:number;remainingQty:number};
export type List={member:Member;wants:Want[];unresolvedImports:{id:string;batchId:string;lineNo:number;rawText:string;parsedName:string|null;qty:number|null;reason:string|null}[];total:{amountHkd:string;pricedCards:number;unpricedCards:number;remainingCopies:number}};
