export type AssetJsonPrimitive = string | number | boolean | null;

export type AssetJsonValue =
  | AssetJsonPrimitive
  | readonly AssetJsonValue[]
  | AssetJsonObject;

export type AssetJsonObject = Readonly<{
  readonly [key: string]: AssetJsonValue;
}>;

export type AssetMetadata = AssetJsonObject;
