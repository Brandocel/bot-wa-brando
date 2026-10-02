-- Quién escribió cada saliente: "bot" o "persona:<email>". Lo anterior queda
-- en null: no se sabe y no se adivina.
ALTER TABLE "Message" ADD COLUMN "sentBy" TEXT;
