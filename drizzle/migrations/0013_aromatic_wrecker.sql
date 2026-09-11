ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_shape" CHECK (
    ("chat_messages"."kind" = 'user' and "chat_messages"."sender_user_id" is not null and "chat_messages"."body" is not null)
    or ("chat_messages"."kind" <> 'user' and "chat_messages"."sender_user_id" is null and "chat_messages"."body" is null));