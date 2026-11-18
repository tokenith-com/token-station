import { useEffect, useState, type ComponentProps } from "react";
import { CrudView } from "./crud-projects";
import type { AdminResource } from "../core/types";
import { ownerUserLabel, stringifyValue } from "../domain/entities";
import { languageLocale, tx } from "../i18n/runtime";
import { useModalFocus } from "../shared/modal-focus";
import { WalletCreditDialog } from "../../admin/views/wallet-credit-dialog";
import { WalletLedger } from "../../admin/views/wallet-ledger";
import { loadWalletBalance, walletMoney } from "../../admin/views/wallet-contract";

type CrudProps = ComponentProps<typeof CrudView<AdminResource>>;
export function WalletCrudView<T>(props: ComponentProps<typeof CrudView<T>>) {
  if (props.config.view !== "teams" || !props.api || !props.currentUser) return <CrudView {...props} />;
  const teamProps = props as unknown as CrudProps;
  return <TeamWalletCrud {...teamProps} api={props.api} currentUser={props.currentUser} />;
}
function TeamWalletCrud(props: CrudProps & Required<Pick<CrudProps, "api" | "currentUser">>) {
  const { api, currentUser } = props;
  const [dialog, setDialog] = useState<{ team: AdminResource; mode: "credit" | "ledger" }>();
  const [revision, setRevision] = useState(0);
  const copy = { tx, locale: languageLocale() };
  const config = { ...props.config,
    columns: [...props.config.columns, { key: "wallet_balance", label: "团队余额（CNY）", render: (team: AdminResource) => <WalletBalance key={`${api.baseURL}:${currentUser?.id}:${team.id}:${revision}`} api={api} teamID={team.id} /> }],
    actions: [...(props.config.actions ?? []),
      ...(currentUser!.role.trim().toLowerCase() === "admin" ? [{ label: "入账", open: (team: AdminResource) => setDialog({ team, mode: "credit" }) }] : []),
      { label: "资金流水", open: (team: AdminResource) => setDialog({ team, mode: "ledger" }) }],
  };
  return <><CrudView {...props} config={config} />{dialog ? <WalletTeamDialog key={`${api.baseURL}:${currentUser?.id}:${dialog.team.id}:${dialog.mode}`} {...dialog} api={api} userID={currentUser!.id} owner={ownerUserLabel(props.data, stringifyValue(dialog.team.fields?.owner))} copy={copy} onClose={() => setDialog(undefined)} onSaved={() => { setRevision(value => value + 1); setDialog(undefined); }} /> : null}</>;
}
function WalletBalance({ api, teamID }: { api: NonNullable<CrudProps["api"]>; teamID: string }) {
  const [state, setState] = useState<{ balance?: number; error?: boolean }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; void loadWalletBalance(api, teamID).then(balance => { if (active) setState({ balance }); }, () => { if (active) setState({ error: true }); }); return () => { active = false; }; }, [api, teamID, revision]);
  return state.error ? <button className="text-button" type="button" onClick={event => { event.stopPropagation(); setState({}); setRevision(value => value + 1); }}>{tx("余额加载失败，重试")}</button> : state.balance === undefined ? <span role="status">{tx("加载中")}</span> : <strong>{walletMoney(state.balance, languageLocale())}</strong>;
}
function WalletTeamDialog({ api, team, mode, userID, owner, copy, onClose, onSaved }: {
  api: NonNullable<CrudProps["api"]>; team: AdminResource; mode: "credit" | "ledger"; userID: string; owner: string;
  copy: { tx: typeof tx; locale: string }; onClose: () => void; onSaved: () => void;
}) {
  const [balance, setBalance] = useState<number>();
  const [balanceError, setBalanceError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; if (mode === "credit") void loadWalletBalance(api, team.id).then(value => { if (active) { setBalance(value); setBalanceError(false); } }, () => { if (active) setBalanceError(true); }); return () => { active = false; }; }, [api, team.id, mode, revision]);
  if (mode === "credit") return <WalletCreditDialog balanceError={balanceError} onRetryBalance={() => { setBalanceError(false); setRevision(value => value + 1); }} api={api} userID={userID} teamID={team.id} teamName={team.name || team.id} owner={owner} balance={balance} copy={copy} onClose={onClose} onSaved={onSaved} />;
  return <LedgerDialog api={api} team={team} copy={copy} onClose={onClose} />;
}
function LedgerDialog({ api, team, copy, onClose }: { api: NonNullable<CrudProps["api"]>; team: AdminResource; copy: { tx: typeof tx; locale: string }; onClose: () => void }) {
  const focus = useModalFocus(onClose);
  return <div className="modal-backdrop"><div {...focus} className="modal wallet-ledger-modal" role="dialog" aria-modal="true" aria-label={tx("资金流水")}><div className="modal-header"><h2>{team.name || team.id}</h2><button className="secondary-button" type="button" onClick={onClose}>{tx("关闭")}</button></div><div className="modal-body wallet-ledger-body"><WalletLedger api={api} teamID={team.id} copy={copy} /></div></div></div>;
}
