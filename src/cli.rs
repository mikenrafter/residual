use anyhow::Result;
use clap::{Parser, Subcommand};

pub mod help;

#[derive(Parser)]
#[command(name = "residual", about = "NKP Residuality architecture CLI", version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Initialize residual/ in the current project.
    ///
    /// Process: idempotent bootstrap — create residual/ CSVs and v3 config
    /// without overwriting existing data. Add attractors before forces.
    Init {
        /// Overwrite session snapshot when residual files drifted outside this tool.
        #[arg(long)]
        force: bool,
    },
    /// Add a residual record.
    ///
    /// Process: examine whole-system-residue before a software-only patch.
    /// Forces carry outcomes, not component lists; map components via residues.
    /// Prefer adding a force (purpose XOR stressor) then a residue mapping.
    Add {
        /// Overwrite session snapshot when residual files drifted outside this tool.
        #[arg(long)]
        force: bool,
        #[command(subcommand)]
        target: AddTarget,
    },
    /// List residual records (filter/group by attractor; not creation order).
    List {
        #[command(subcommand)]
        target: ListTarget,
    },
    /// Verify residual integrity.
    ///
    /// Process: one-way tags (code tags must exist in metadata; metadata-only is
    /// OK). Walks require at least two personas until alpha/beta exist.
    /// Policy (super_strict, token_warn) is read from storage-config.
    Verify {
        #[command(subcommand)]
        check: VerifyCheck,
    },
    /// NKP matrix operations (structure-analysis).
    ///
    /// Process: filter/group by attractor when reading; do not assume creation order.
    Matrix {
        #[command(subcommand)]
        op: MatrixOp,
    },
    SkillShow {
        name: String,
        #[arg(long)]
        version: bool,
    },
    SkillInstall {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
        #[arg(long)]
        global: bool,
    },
    SkillData {
        name: String,
    },
    SkillList,
    /// Alias for `skill check-install`.
    SkillCheck {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
    },
    /// Phase + installer skills.
    ///
    /// Process: a-la-carte — only the invoked subcommand carries ceremony.
    Skill {
        #[command(subcommand)]
        op: SkillCommand,
    },
    Tag {
        #[command(subcommand)]
        op: TagOp,
    },
    /// Generate help artifacts (completions/man) or the verification git hook.
    Generate {
        #[command(subcommand)]
        artifact: GenerateArtifact,
    },
    Config,
}

#[derive(Subcommand)]
pub enum SkillCommand {
    /// Show an embedded phase skill definition.
    ///
    /// Process: read the skill a-la-carte; unused phase ceremony is not loaded.
    Show {
        name: String,
        #[arg(long)]
        version: bool,
    },
    /// Print residual context for a phase skill.
    ///
    /// Process: load only the data that phase needs. Walks that use personas
    /// require min:2 (Verification).
    Data { name: String },
    /// List phase skills (stub + full) with token estimates.
    List,
    /// Install a phase skill into an agent directory.
    Install {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
        #[arg(long)]
        global: bool,
    },
    /// Check whether an installed skill matches the embedded version.
    ///
    /// Process: compare installed front-matter version to the binary. Prefer
    /// this name over legacy `skill-check`.
    CheckInstall {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
    },
}

#[derive(Subcommand)]
pub enum AddTarget {
    /// Add a stressor force. Process: whole-system-residue first — outcomes not traits.
    Stressor {
        #[arg(long)] description: String,
        #[arg(long)] attractor_id: String,
        #[arg(long)] naive_change: String,
        #[arg(long, default_value = "")] traits: String,
        #[arg(long, default_value = "")] components: String,
    },
    /// Add a purpose force. Process: whole-system-residue first — outcomes not traits.
    Purpose {
        #[arg(long)] description: String,
        #[arg(long)] attractor_id: String,
        #[arg(long)] feature: String,
        #[arg(long, default_value = "")] traits: String,
        #[arg(long, default_value = "")] components: String,
    },
    Attractor {
        #[arg(long)] name: String,
        #[arg(long)] valence: String,
        #[arg(long)] description: String,
        #[arg(long, default_value = "")] phase_state: String,
    },
    Term {
        #[arg(long)] term: String,
        #[arg(long)] definition: String,
        #[arg(long, default_value = "")] domain: String,
        #[arg(long, default_value = "")] related: String,
    },
    Persona {
        #[arg(long)] name: String,
        #[arg(long)] role: String,
        #[arg(long, default_value = "")] concerns: String,
        #[arg(long, default_value = "")] desires: String,
    },
    Iteration {
        #[arg(long, default_value = "")] notes: String,
        #[arg(long, default_value = "")] ri_score: String,
    },
}

#[derive(Subcommand)]
pub enum ListTarget {
    Stressors,
    Purposes,
    Attractors,
    Terminology,
    Personas,
    Iterations,
}

#[derive(Subcommand)]
pub enum VerifyCheck {
    Traits,
    Links,
    All,
}

#[derive(Subcommand)]
pub enum MatrixOp {
    Show,
    Calc,
    Criticality,
    Ri {
        #[arg(long)] stressors: usize,
        #[arg(long)] naive_survived: usize,
        #[arg(long)] residual_survived: usize,
    },
    Fusion,
    Fission,
}

#[derive(Subcommand)]
pub enum TagOp {
    Scan {
        #[arg(default_value = ".")] path: String,
    },
    Report {
        #[arg(default_value = ".")] path: String,
    },
}

#[derive(Subcommand)]
pub enum GenerateArtifact {
    Completions,
    Man,
    Hook,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    let cfg = crate::config::load()?;

    match cli.command {
        Command::Init { force } => crate::storage::init(&cfg, force),
        Command::Add { force, target } => crate::storage::add(&cfg, target, force),
        Command::List { target } => crate::storage::list(&cfg, target),
        Command::Verify { check } => crate::verification::run(&cfg, check),
        Command::Matrix { op } => crate::structure::analysis::nkp::run(&cfg, op),
        Command::SkillShow { name, version } => crate::skills::phases::show(&name, version),
        Command::SkillInstall { name, agent, global } => {
            crate::skills::installer::install(&name, &agent, global)
        }
        Command::SkillData { name } => crate::skills::phases::data(&cfg, &name),
        Command::SkillList => crate::skills::phases::list_all(),
        Command::SkillCheck { name, agent } => crate::skills::installer::check(&name, &agent),
        Command::Skill { op } => match op {
            SkillCommand::Show { name, version } => crate::skills::phases::show(&name, version),
            SkillCommand::Data { name } => crate::skills::phases::data(&cfg, &name),
            SkillCommand::List => crate::skills::phases::list_all(),
            SkillCommand::Install { name, agent, global } => {
                crate::skills::installer::install(&name, &agent, global)
            }
            SkillCommand::CheckInstall { name, agent } => {
                crate::skills::installer::check_install(&name, &agent)
            }
        },
        Command::Tag { op } => crate::structure::analysis::tag_scan::run(&cfg, op),
        Command::Generate { artifact } => match artifact {
            GenerateArtifact::Completions => crate::cli::help::generate_completions(),
            GenerateArtifact::Man => crate::cli::help::generate_man(),
            GenerateArtifact::Hook => crate::verification::git_hook::install(),
        },
        Command::Config => crate::config::print(&cfg),
    }
}
